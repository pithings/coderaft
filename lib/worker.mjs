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

process.on("uncaughtException", forwardFatal("uncaughtException"));
process.on("unhandledRejection", forwardFatal("unhandledRejection"));
