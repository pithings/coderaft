import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import type { StartCodeServerOptions } from "./server.ts";

export interface SpawnProcessOptions {
  /** Extra environment variables merged into the worker's `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Node.js exec argv forwarded to the worker (e.g. `["--inspect"]`). */
  execArgv?: string[];
  /**
   * stdio for the forked worker. Defaults to `"inherit"` for stdout/stderr and
   * `"ignore"` for stdin. Pass `"pipe"` to capture output via `handle.proc`.
   */
  stdio?: "inherit" | "pipe" | "ignore";
  /**
   * Max ms to wait for the worker to report `ready`. Defaults to 60000.
   * On timeout, the worker is killed and the promise rejects.
   */
  startupTimeout?: number;
}

export interface SpawnCodeServerOptions extends StartCodeServerOptions {
  /** Options for the forked worker process. */
  spawn?: SpawnProcessOptions;
}

interface WorkerState {
  proc: ChildProcess;
  url: string;
  port?: number;
  socketPath?: string;
  connectionToken: string;
}

type WorkerMessage =
  | { type: "ready"; url: string; port?: number; socketPath?: string; connectionToken: string }
  | { type: "error"; message?: string };

export interface SpawnedCodeServer {
  /**
   * Emitted when the handle loses its worker: crash, explicit kill, or a
   * `reload()` whose respawn failed (the old worker is already gone; the
   * failure also rejects the `reload()` promise). Not emitted for `close()`
   * or the successful half of `reload()`.
   */
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  /**
   * Emitted for worker `error` events (spawn failure, IPC send failure) and
   * for post-ready fatal errors forwarded by the worker (uncaughtException,
   * unhandledRejection).
   */
  on(event: "error", listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export class SpawnedCodeServer extends EventEmitter {
  /** The forked worker process (changes after `reload`). */
  proc!: ChildProcess;
  url!: string;
  /** TCP port the server is bound to, or `undefined` when listening on a unix socket. */
  port?: number;
  /** Unix socket path the server is bound to, or `undefined` when listening on TCP. */
  socketPath?: string;
  connectionToken!: string;

  readonly #opts: SpawnCodeServerOptions;
  #detach!: () => void;
  #reloading: Promise<void> | undefined;
  #closed = false;

  private constructor(opts: SpawnCodeServerOptions, state: WorkerState) {
    super();
    this.#opts = opts;
    this.#adopt(state);
  }

  /** Spawn a new worker and resolve with a handle once it reports ready. */
  static async spawn(opts: SpawnCodeServerOptions = {}): Promise<SpawnedCodeServer> {
    return new SpawnedCodeServer(opts, await spawnWorker(opts));
  }

  /** Terminate the worker process. Sends SIGTERM, then SIGKILL after 5s. Idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#reloading) {
      try {
        await this.#reloading;
      } catch {
        // Reload failed; fall through to terminate whatever child we have.
      }
    }
    this.#detach();
    await terminateChild(this.proc);
  }

  /** Kill the current worker and spawn a new one with the original options. */
  async reload(): Promise<void> {
    if (this.#closed) throw new Error("SpawnedCodeServer is closed");
    if (this.#reloading) return this.#reloading;
    this.#reloading = (async () => {
      this.#detach();
      await terminateChild(this.proc);
      if (this.#closed) throw new Error("SpawnedCodeServer was closed during reload");
      let next: WorkerState;
      try {
        next = await spawnWorker(this.#opts);
      } catch (err) {
        // Spawn failed and the old worker is already terminated. Surface that
        // as a synthetic `exit` so consumers don't have to poll `proc.exitCode`
        // to notice the handle is childless. Caller can still retry `reload()`
        // or `close()`.
        const dead = this.proc;
        queueMicrotask(() => this.emit("exit", dead.exitCode, dead.signalCode));
        throw err;
      }
      if (this.#closed) {
        await terminateChild(next.proc);
        throw new Error("SpawnedCodeServer was closed during reload");
      }
      this.#adopt(next);
    })();
    try {
      await this.#reloading;
    } finally {
      this.#reloading = undefined;
    }
  }

  #adopt(state: WorkerState): void {
    this.proc = state.proc;
    this.url = state.url;
    this.port = state.port;
    this.socketPath = state.socketPath;
    this.connectionToken = state.connectionToken;
    this.#detach = this.#attachListeners(state.proc);
  }

  #attachListeners(proc: ChildProcess): () => void {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      this.emit("exit", code, signal);
    const onError = (err: Error) => this.emit("error", err);
    const onMessage = (msg: WorkerMessage) => {
      if (msg?.type === "error") {
        this.emit("error", new Error(msg.message ?? "worker error"));
      }
    };
    proc.on("exit", onExit);
    proc.on("error", onError);
    proc.on("message", onMessage);
    return () => {
      proc.off("exit", onExit);
      proc.off("error", onError);
      proc.off("message", onMessage);
    };
  }
}

export function spawnCodeServer(opts: SpawnCodeServerOptions = {}): Promise<SpawnedCodeServer> {
  return SpawnedCodeServer.spawn(opts);
}

async function spawnWorker(opts: SpawnCodeServerOptions): Promise<WorkerState> {
  const { spawn: spawnOpts = {}, ...serverOpts } = opts;
  const { env, execArgv, stdio = "inherit", startupTimeout = 60_000 } = spawnOpts;
  const workerPath = fileURLToPath(import.meta.resolve("#worker"));

  // Drop any inherited `CODE_SERVER_PARENT_PID` so the worker sets its own. The
  // value is only used as a truthy flag to suppress server-main.js's auto-boot
  // (see server.ts), but keeping it tied to this process's PID is clearer.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete childEnv.CODE_SERVER_PARENT_PID;

  const proc = fork(workerPath, {
    stdio: ["ignore", stdio, stdio, "ipc"],
    env: childEnv,
    ...(execArgv !== undefined ? { execArgv } : {}),
  });

  const ready = await new Promise<Extract<WorkerMessage, { type: "ready" }>>((resolve, reject) => {
    const onMessage = (msg: WorkerMessage) => {
      if (msg?.type === "ready") {
        cleanup();
        resolve(msg);
      } else if (msg?.type === "error") {
        cleanup();
        reject(new Error(msg.message ?? "worker error"));
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`coderaft worker exited before ready (code=${code})`));
    };
    const onError = (err: Error) => {
      cleanup();
      proc.kill("SIGKILL");
      reject(err);
    };
    const timer = setTimeout(() => {
      cleanup();
      proc.kill("SIGKILL");
      reject(new Error(`coderaft worker did not become ready within ${startupTimeout}ms`));
    }, startupTimeout);
    timer.unref?.();
    const cleanup = () => {
      clearTimeout(timer);
      proc.off("message", onMessage);
      proc.off("exit", onExit);
      proc.off("error", onError);
    };
    proc.on("message", onMessage);
    proc.once("exit", onExit);
    proc.once("error", onError);
    proc.send({ type: "start", opts: serverOpts }, (err) => {
      if (err) {
        cleanup();
        reject(err);
      }
    });
  });

  return {
    proc,
    url: ready.url,
    port: ready.port,
    socketPath: ready.socketPath,
    connectionToken: ready.connectionToken,
  };
}

async function terminateChild(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGKILL");
      }
    }, 5000);
    timer.unref?.();
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}
