// Minimal @vscode/native-watchdog shim — drops the native C++ addon that
// monitors a parent pid from a background thread and force-exits the
// current process if the parent dies.
//
// VS Code's extension host uses this as a safety net against orphaned
// ext-host processes when the main process crashes. It's a best-effort
// cleanup feature, not a correctness requirement: under a supervisor
// (systemd, docker, launchd) orphans get reaped anyway, and the IPC
// channel close from the dying parent already triggers normal shutdown.
//
// The shim keeps the API surface (start/exit) but does nothing on start.

let hasStarted = false;

exports.start = function (pid) {
  if (typeof pid !== "number" || Math.round(pid) !== pid) {
    throw new Error("Expected integer pid!");
  }
  if (hasStarted) {
    throw new Error("Can only monitor a single process!");
  }
  hasStarted = true;
};

exports.exit = function (code) {
  process.exit(code || 0);
};
