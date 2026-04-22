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
   * `"ignore"` for stdin. Pass `"pipe"` to capture output via `handle.child`.
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
  child: ChildProcess;
  url: string;
  port?: number;
  socketPath?: string;
  connectionToken: string;
}

type WorkerMessage =
  | { type: "ready"; url: string; port?: number; socketPath?: string; connectionToken: string }
  | { type: "error"; message?: string };

export interface SpawnedCodeServer {
  /** Emitted when the worker process exits (other than via `close()` / `reload()`). */
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  /** Emitted when the worker emits an `error` (spawn failure, IPC send failure, …). */
  on(event: "error", listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export class SpawnedCodeServer extends EventEmitter {
  readonly #opts: SpawnCodeServerOptions;
  #state: WorkerState;
  #detachListeners: () => void;
  #reloading: Promise<void> | undefined;
  #closed = false;

  private constructor(opts: SpawnCodeServerOptions, state: WorkerState) {
    super();
    this.#opts = opts;
    this.#state = state;
    this.#detachListeners = this.#attachListeners(state.child);
  }

  /** Spawn a new worker and resolve with a handle once it reports ready. */
  static async spawn(opts: SpawnCodeServerOptions = {}): Promise<SpawnedCodeServer> {
    const state = await spawnWorker(opts);
    return new SpawnedCodeServer(opts, state);
  }

  /** The forked worker process (changes after `reload`). */
  get child(): ChildProcess {
    return this.#state.child;
  }

  /** TCP port the server is bound to, or `undefined` when listening on a unix socket. */
  get port(): number | undefined {
    return this.#state.port;
  }

  /** Unix socket path the server is bound to, or `undefined` when listening on TCP. */
  get socketPath(): string | undefined {
    return this.#state.socketPath;
  }

  get url(): string {
    return this.#state.url;
  }

  get connectionToken(): string {
    return this.#state.connectionToken;
  }

  /** Terminate the worker process. Sends SIGTERM, then SIGKILL after 5s. Idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#reloading) {
      try {
        await this.#reloading;
      } catch {
        // Reload failed; fall through to terminate whatever #state points at.
      }
    }
    this.#detachListeners();
    await terminateChild(this.#state.child);
  }

  /** Kill the current worker and spawn a new one with the original options. */
  async reload(): Promise<void> {
    if (this.#closed) throw new Error("SpawnedCodeServer is closed");
    if (this.#reloading) return this.#reloading;
    this.#reloading = (async () => {
      this.#detachListeners();
      await terminateChild(this.#state.child);
      if (this.#closed) throw new Error("SpawnedCodeServer was closed during reload");
      const next = await spawnWorker(this.#opts);
      if (this.#closed) {
        await terminateChild(next.child);
        throw new Error("SpawnedCodeServer was closed during reload");
      }
      this.#state = next;
      this.#detachListeners = this.#attachListeners(next.child);
    })();
    try {
      await this.#reloading;
    } finally {
      this.#reloading = undefined;
    }
  }

  #attachListeners(child: ChildProcess): () => void {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      this.emit("exit", code, signal);
    const onError = (err: Error) => this.emit("error", err);
    child.on("exit", onExit);
    child.on("error", onError);
    return () => {
      child.off("exit", onExit);
      child.off("error", onError);
    };
  }
}

export function spawnCodeServer(
  opts: SpawnCodeServerOptions = {},
): Promise<SpawnedCodeServer> {
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

  const child = fork(workerPath, {
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
      child.kill("SIGKILL");
      reject(err);
    };
    const timer = setTimeout(() => {
      cleanup();
      child.kill("SIGKILL");
      reject(new Error(`coderaft worker did not become ready within ${startupTimeout}ms`));
    }, startupTimeout);
    timer.unref?.();
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onError);
    child.send({ type: "start", opts: serverOpts }, (err) => {
      if (err) {
        cleanup();
        reject(err);
      }
    });
  });

  return {
    child,
    url: ready.url,
    port: ready.port,
    socketPath: ready.socketPath,
    connectionToken: ready.connectionToken,
  };
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 5000);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
