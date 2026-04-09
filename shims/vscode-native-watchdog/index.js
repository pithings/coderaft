// Pure-JS @vscode/native-watchdog — replaces the native C++ addon that monitors
// a parent pid from a background thread and force-exits the current process if
// the parent dies. This implementation polls with setInterval instead, avoiding
// native threading issues (e.g. futex deadlocks on Node v25).

let hasStarted = false;

exports.start = function (pid) {
  if (typeof pid !== "number" || Math.round(pid) !== pid) {
    throw new Error("Expected integer pid!");
  }
  if (hasStarted) {
    throw new Error("Can only monitor a single process!");
  }
  hasStarted = true;
  // console.log(`[coderaft] Watchdog: monitoring parent pid ${pid} from pid ${process.pid}`);

  const interval = setInterval(() => {
    try {
      process.kill(pid, 0); // Throws if pid doesn't exist
    } catch {
      console.log(
        `[coderaft] Watchdog: parent pid ${pid} is gone, exiting pid ${process.pid} in 6s`,
      );
      clearInterval(interval);
      setTimeout(() => process.exit(87), 6000).unref();
      return;
    }
  }, 3000);
  interval.unref();
};

exports.exit = function (code) {
  process.exit(code || 0);
};
