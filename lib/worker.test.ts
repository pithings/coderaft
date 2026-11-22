// Integration coverage for the worker's fatal-error filtering (lib/worker.mjs).
//
// The worker is a forked entry that imports the built code-server from
// ./dist/index.mjs, so these tests run the *actual shipped* worker.mjs bytes
// against a stubbed code-server entry in a temp dir — no build required, and
// the fork/IPC contract with lib/src/spawn.ts (forward `{ type: "error" }`,
// then exit 1) is exercised end-to-end.
//
// Cases mirror the production crash loop:
//   - a VS Code `CancellationError` (name AND message "Canceled") must NOT
//     terminate the worker, whether it arrives as a rejection or an exception;
//   - a rejection that gets a handler within the grace period is not fatal;
//   - any other rejection must still be forwarded to the parent and exit 1,
//     so SpawnedCodeServer's respawn contract is unchanged.

import { fork, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const workerSource = readFileSync(fileURLToPath(new URL("./worker.mjs", import.meta.url)), "utf8");

type WorkerMessage = { type: string } & Record<string, unknown>;
type ExitResult = { code: number | null; signal: NodeJS.Signals | null };

interface WorkerHarness {
  child: ChildProcess;
  messages: WorkerMessage[];
  /** Mutable container — the `data` callback fills it after `fork()` returns. */
  stderr: { text: string };
  exit: Promise<ExitResult>;
  exited: boolean;
  dir: string;
}

const running: WorkerHarness[] = [];

function spawnWorker(serverBody: string): WorkerHarness {
  const dir = mkdtempSync(join(tmpdir(), "coderaft-worker-test-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "worker.mjs"), workerSource);
  writeFileSync(
    join(dir, "dist", "index.mjs"),
    `export function startCodeServer() { ${serverBody} }`,
  );

  const child = fork(join(dir, "worker.mjs"), {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  const harness: WorkerHarness = {
    child,
    messages: [],
    stderr: { text: "" },
    exit: undefined as unknown as Promise<ExitResult>,
    exited: false,
    dir,
  };
  // Register before anything can fail so afterEach always cleans up.
  running.push(harness);
  child.on("message", (msg) => harness.messages.push(msg as WorkerMessage));
  child.stderr?.on("data", (chunk: Buffer) => {
    harness.stderr.text += chunk.toString();
  });
  harness.exit = new Promise<ExitResult>((resolve) => {
    child.once("exit", (code, signal) => {
      harness.exited = true;
      resolve({ code, signal });
    });
  });
  return harness;
}

const READY_HANDLE =
  `return { url: "http://127.0.0.1:8080", port: 8080, ` +
  `socketPath: undefined, connectionToken: "test", close: async () => {} };`;

/** A VS Code `CancellationError` — name and message are both "Canceled". */
const CANCELLATION_ERROR = `Object.assign(new Error("Canceled"), { name: "Canceled" })`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startWorker(serverBody: string): Promise<WorkerHarness> {
  const harness = spawnWorker(serverBody);
  harness.child.send({ type: "start", opts: {} });
  await waitFor(() => harness.messages.some((m) => m.type === "ready"), "worker ready");
  return harness;
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await delay(10);
  }
}

async function expectStaysAlive(harness: WorkerHarness): Promise<void> {
  // Outlast the worker's 1s unhandled-rejection grace period.
  await delay(1300);
  expect(harness.messages.some((m) => m.type === "error")).toBe(false);
  expect(harness.exited).toBe(false);
}

describe("worker fatal-error filter", () => {
  afterEach(async () => {
    for (const harness of running) {
      if (!harness.exited) {
        harness.child.kill("SIGTERM");
        await Promise.race([harness.exit, delay(1000)]);
        if (!harness.exited) {
          harness.child.kill("SIGKILL");
          await harness.exit;
        }
      }
      rmSync(harness.dir, { recursive: true, force: true });
    }
    running.length = 0;
  });

  it("does not terminate on a Canceled rejection, and logs it once", async () => {
    const harness = await startWorker(`
      setTimeout(() => {
        Promise.reject(${CANCELLATION_ERROR});
        Promise.reject(${CANCELLATION_ERROR});
      }, 20);
      ${READY_HANDLE}
    `);

    await waitFor(() => harness.stderr.text.includes("ignoring Canceled error"), "log line");
    await expectStaysAlive(harness);
    expect(harness.stderr.text.split("ignoring Canceled error").length - 1).toBe(1);
  });

  it("does not terminate on a Canceled uncaught exception", async () => {
    const harness = await startWorker(`
      setTimeout(() => { throw ${CANCELLATION_ERROR}; }, 20);
      ${READY_HANDLE}
    `);

    await waitFor(() => harness.stderr.text.includes("ignoring Canceled error"), "log line");
    await expectStaysAlive(harness);
  });

  it("does not terminate when a rejection is handled within the grace period", async () => {
    const harness = await startWorker(`
      setTimeout(() => {
        const p = Promise.reject(new Error("handled later"));
        setTimeout(() => p.catch(() => {}), 100);
      }, 20);
      ${READY_HANDLE}
    `);

    await expectStaysAlive(harness);
  });

  it.each([
    ["a non-Canceled error", `new Error("ptyHost resolve failed")`, "ptyHost resolve failed"],
    ["an Error whose message alone is Canceled", `new Error("Canceled")`, "Canceled"],
    [
      "an Error named Canceled with a real message",
      `Object.assign(new Error("disk full"), { name: "Canceled" })`,
      "disk full",
    ],
  ])("forwards %s to the parent and exits 1", async (_label, error, expected) => {
    const harness = await startWorker(`
      setTimeout(() => { Promise.reject(${error}); }, 20);
      ${READY_HANDLE}
    `);

    const result = await Promise.race([harness.exit, delay(3000).then(() => null)]);

    expect(result?.code).toBe(1);
    const forwarded = harness.messages.find((m) => m.type === "error");
    expect(forwarded).toBeDefined();
    expect(String(forwarded?.message)).toContain("unhandledRejection");
    expect(String(forwarded?.message)).toContain(expected);
  });
});
