// Integration coverage for the worker's `Canceled`-rejection filter
// (lib/worker.mjs).
//
// The worker is a forked entry that imports the built code-server from
// ./dist/index.mjs, so these tests run the *actual shipped* worker.mjs bytes
// against a stubbed code-server entry in a temp dir — no build required, and
// the fork/IPC contract with lib/src/spawn.ts (forward `{ type: "error" }`,
// then exit 1) is exercised end-to-end.
//
// Cases mirror the production crash loop:
//   - a `Canceled` rejection (by name OR message — the cancelled ptyHost
//     resolved-variables RPC shape) must NOT terminate the worker;
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

interface WorkerHarness {
  child: ChildProcess;
  messages: WorkerMessage[];
  /** Mutable container — the `data` callback fills it after `fork()` returns. */
  stderr: { text: string };
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  dir: string;
}

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
  });
  const messages: WorkerMessage[] = [];
  const stderr: { text: string } = { text: "" };
  child.on("message", (msg) => messages.push(msg as WorkerMessage));
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr.text += chunk.toString();
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, messages, stderr, exit, dir };
}

const READY_HANDLE =
  `return { url: "http://127.0.0.1:8080", port: 8080, ` +
  `socketPath: undefined, connectionToken: "test" };`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startWorker(serverBody: string): Promise<WorkerHarness> {
  const harness = spawnWorker(serverBody);
  harness.child.send({ type: "start", opts: {} });
  await waitForReady(harness);
  return harness;
}

function waitForReady(harness: WorkerHarness, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (harness.messages.some((m) => m.type === "ready")) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error("worker did not become ready"));
      } else {
        setTimeout(poll, 10);
      }
    };
    poll();
  });
}

describe("worker unhandledRejection filter", () => {
  const running: WorkerHarness[] = [];

  afterEach(async () => {
    for (const harness of running) {
      harness.child.kill("SIGTERM");
      await Promise.race([harness.exit, delay(1000)]);
      rmSync(harness.dir, { recursive: true, force: true });
    }
    running.length = 0;
  });

  it("does not terminate on a Canceled rejection (by name)", async () => {
    const harness = await startWorker(`
      setTimeout(() => {
        Promise.reject(Object.assign(new Error("canceled"), { name: "Canceled" }));
      }, 20);
      ${READY_HANDLE}
    `);
    running.push(harness);

    await delay(200);

    expect(harness.messages.some((m) => m.type === "error")).toBe(false);
    expect(harness.child.exitCode).toBeNull();
    expect(harness.stderr.text).toContain("ignoring Canceled rejection");
  });

  it("does not terminate on a Canceled rejection (by message)", async () => {
    const harness = await startWorker(`
      setTimeout(() => {
        Promise.reject(new Error("Canceled"));
      }, 20);
      ${READY_HANDLE}
    `);
    running.push(harness);

    await delay(200);

    expect(harness.messages.some((m) => m.type === "error")).toBe(false);
    expect(harness.child.exitCode).toBeNull();
    expect(harness.stderr.text).toContain("ignoring Canceled rejection");
  });

  it("forwards a non-Canceled rejection to the parent and exits 1", async () => {
    const harness = await startWorker(`
      setTimeout(() => {
        Promise.reject(new Error("ptyHost resolve failed"));
      }, 20);
      ${READY_HANDLE}
    `);
    running.push(harness);

    const result = await Promise.race([harness.exit, delay(2000).then(() => null)]);

    expect(result?.code).toBe(1);
    const forwarded = harness.messages.find((m) => m.type === "error");
    expect(forwarded).toBeDefined();
    expect(String(forwarded?.message)).toContain("unhandledRejection");
    expect(String(forwarded?.message)).toContain("ptyHost resolve failed");
  });
});
