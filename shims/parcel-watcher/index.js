// Minimal @parcel/watcher shim — replaces the native C++ file watcher with
// Node.js built-in fs.watch (recursive mode). This trades the native backend's
// snapshot/history features for zero native binaries.
//
// Limitations vs native:
// - getEventsSince / writeSnapshot are no-ops (snapshot-based history unsupported)
// - No glob-based ignore filtering (ignore option is not implemented)
// - Relies on fs.watch recursive support (Node 19+ on all platforms, or macOS/Windows on older versions)

const fs = require("node:fs");
const path = require("node:path");

// Prevent SIGINT from killing the file watcher child process.
// The native @parcel/watcher runs in-process as a C++ addon and is immune to
// SIGINT, but this JS shim runs in a forked utility process that inherits the
// signal. The parent (VS Code server) manages the lifecycle via IPC — if we
// let SIGINT through, the watcher dies and VS Code logs "ETERM" errors.
if (!process.listenerCount("SIGINT")) {
  process.on("SIGINT", () => {});
}

// On Android/Termux the kernel caps `fs.inotify.max_user_watches` very low
// and the limit can't be raised, so virtually every `fs.watch()` call after
// the first handful fails with ENOSPC. Restricted system dirs (/apex/*,
// /system/*) also fail with EACCES/EPERM. Swallow these silently — the path
// just isn't watched, which is the effective outcome anyway. Warn once per
// code so the user knows why.
const SILENCED_WATCH_ERRORS = new Set(["ENOSPC", "EACCES", "EPERM"]);
const warnedWatchErrors = new Set();
function isSilencedWatchError(err) {
  if (!err || !SILENCED_WATCH_ERRORS.has(err.code)) return false;
  if (!warnedWatchErrors.has(err.code)) {
    warnedWatchErrors.add(err.code);
    console.warn(
      `[coderaft] fs.watch ${err.code} — @parcel/watcher shim silently dropping watches (further ${err.code} errors suppressed)`,
    );
  }
  return true;
}

class AsyncSubscription {
  /** @param {fs.FSWatcher} watcher */
  constructor(watcher) {
    this._watcher = watcher;
  }
  async unsubscribe() {
    this._watcher.close();
  }
}

/**
 * @param {string} dir
 * @param {(err: Error | null, events: Array<{path: string, type: string}>) => void} fn
 * @param {object} [_opts]
 * @returns {Promise<AsyncSubscription>}
 */
async function subscribe(dir, fn, _opts) {
  const resolvedDir = path.resolve(dir);
  let watcher;
  try {
    watcher = fs.watch(resolvedDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const fullPath = path.join(resolvedDir, filename);
      // fs.watch only gives "rename" or "change" — map to @parcel/watcher event types.
      // "rename" fires for both creation and deletion; disambiguate with existsSync.
      const type =
        eventType === "rename" ? (fs.existsSync(fullPath) ? "create" : "delete") : "update";
      fn(null, [{ path: fullPath, type }]);
    });
  } catch (err) {
    // fs.watch throws synchronously on permission errors (EACCES) or missing
    // dirs. Return a no-op subscription instead of crashing the caller.
    // On Android/Termux, swallow ENOSPC/EACCES/EPERM silently (see above).
    if (!isSilencedWatchError(err)) fn(err, []);
    return new AsyncSubscription({ close() {} });
  }
  watcher.on("error", (err) => {
    if (isSilencedWatchError(err)) return;
    fn(err, []);
  });
  return new AsyncSubscription(watcher);
}

/**
 * @param {string} _dir
 * @param {(err: Error | null, events: Array<{path: string, type: string}>) => void} fn
 * @param {object} [_opts]
 * @returns {Promise<void>}
 */
async function unsubscribe(_dir, _fn, _opts) {
  // No-op — callers should use subscription.unsubscribe() instead
}

/**
 * @param {string} _dir
 * @param {string} _snapshot
 * @param {object} [_opts]
 * @returns {Promise<Array<{path: string, type: string}>>}
 */
async function getEventsSince(_dir, _snapshot, _opts) {
  // Snapshot-based history not supported in fs.watch shim
  return [];
}

/**
 * @param {string} _dir
 * @param {string} snapshot
 * @param {object} [_opts]
 * @returns {Promise<string>}
 */
async function writeSnapshot(_dir, snapshot, _opts) {
  // No-op — return the snapshot path for API compatibility
  return snapshot;
}

module.exports = { subscribe, unsubscribe, getEventsSince, writeSnapshot };
