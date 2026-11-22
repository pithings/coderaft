// Forked worker entry used by `spawnCodeServer`. Starts a coderaft code server
// on IPC `{ type: "start", opts }` and replies with `{ type: "ready", ... }`.
// On SIGTERM/SIGINT, gracefully closes the server before exiting so the parent's
// `handle.close()` cleanly disposes VS Code and releases sockets/locks.
import { startCodeServer } from "./dist/index.mjs";

let handle;
let shuttingDown = false;

process.on("message", async (msg) => {
  if (msg?.type !== "start") return;
  try {
    handle = await startCodeServer(msg.opts);
    process.send?.({
      type: "ready",
      url: handle.url,
      port: handle.port,
      socketPath: handle.socketPath,
      connectionToken: handle.connectionToken,
    });
  } catch (err) {
    // Flush the error message over IPC before exiting — `process.exit` can
    // tear down the channel before the message reaches the parent, which
    // would leave the parent rejecting with the generic `exited before ready`.
    const exit = () => process.exit(1);
    if (process.send) {
      process.send({ type: "error", message: err?.message ?? String(err) }, exit);
    } else {
      exit();
    }
  }
});

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await handle?.close();
  } catch (err) {
    console.error(`[coderaft worker] close failed on ${signal}:`, err);
  }
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Forward fatal async errors to the parent before exiting. Without this, the
// parent only sees an anonymous non-zero exit and has to scrape stderr for the
// reason — which is the exact failure mode the pre-ready IPC flush avoids.
const forwardFatal = (kind) => (err) => {
  if (shuttingDown) return;
  shuttingDown = true;
  const detail = err?.stack ?? err?.message ?? String(err);
  const exit = () => process.exit(1);
  if (process.send) {
    process.send({ type: "error", message: `[${kind}] ${detail}` }, exit);
  } else {
    exit();
  }
};

// VS Code's promise-cancellation races surface as `CancellationError`s — for
// example RequestStore's timeout promise rejecting when a pending ptyHost
// resolved-variables request is cancelled on extension-host restart (it has
// no rejection handler). Those are by design, not bugs: VS Code's own
// handlers ignore them. Treating them as fatal makes every extension-host
// restart crash the worker, and because the parent respawns us and the
// browser reconnects, the same race fires again — a self-sustaining crash
// loop. Mirrors VS Code's `isCancellationError` (src/vs/base/common/errors.ts).
const isCanceled = (err) =>
  err instanceof Error && err.name === "Canceled" && err.message === "Canceled";

// RequestStore cancels its timeout on every successful reply, so these are
// frequent in normal operation. Log the first one only.
let loggedCanceled = false;
const ignoreCanceled = (err) => {
  if (loggedCanceled || shuttingDown) return;
  loggedCanceled = true;
  console.error(
    "[coderaft worker] ignoring Canceled error (further ones will not be logged):",
    err,
  );
};

// With `--unhandled-rejections=strict` (e.g. via NODE_OPTIONS), rejections
// arrive here instead of `unhandledRejection`, so filter in both places.
process.on("uncaughtException", (err) => {
  if (isCanceled(err)) return ignoreCanceled(err);
  forwardFatal("uncaughtException")(err);
});

// Node emits `unhandledRejection` as soon as a rejected promise has no handler
// at the end of a microtask drain, even if one is attached a tick later. Like
// VS Code, give it a grace period and only treat it as fatal if it is still
// unhandled afterwards.
const UNHANDLED_REJECTION_GRACE_MS = 1000;
const pendingRejections = new Map();

process.on("unhandledRejection", (reason, promise) => {
  if (shuttingDown) return;
  if (isCanceled(reason)) return ignoreCanceled(reason);
  pendingRejections.set(promise, reason);
  setTimeout(() => {
    if (!pendingRejections.delete(promise)) return;
    forwardFatal("unhandledRejection")(reason);
  }, UNHANDLED_REJECTION_GRACE_MS);
});

process.on("rejectionHandled", (promise) => {
  pendingRejections.delete(promise);
});
