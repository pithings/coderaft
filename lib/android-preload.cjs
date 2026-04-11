// Android/Termux preload — injected via NODE_OPTIONS --require into all child
// processes. VS Code strips LD_PRELOAD from forked processes, which breaks two
// things that termux-exec normally handles:
//   1. /proc/self/exe → process.execPath resolves to the Android linker
//   2. execve() of Termux binaries fails with EACCES (noexec mount / SELinux)
//
// VS Code's bundled code also explicitly `delete env.LD_PRELOAD` from the env
// object passed to child_process.fork/spawn, so simply restoring process.env
// is not enough — we must monkey-patch child_process.spawn to re-inject it.
"use strict";

// Fix process.execPath when termux-exec is unavailable
const execPath = process.execPath;
if (execPath.includes("linker64") || execPath.startsWith("/apex/")) {
  const resolved =
    process.env.TERMUX_EXEC__PROC_SELF_EXE || "/data/data/com.termux/files/usr/bin/node";
  Object.defineProperty(process, "execPath", {
    value: resolved,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

// Ensure LD_PRELOAD with termux-exec is always present in child process envs.
// VS Code strips it via `delete env.LD_PRELOAD` before spawning children.
// We patch child_process.spawn (which fork() calls internally) to re-inject it.
const TERMUX_EXEC_LIB = "/data/data/com.termux/files/usr/lib/libtermux-exec.so";
let _termuxExecExists;
function termuxExecExists() {
  if (_termuxExecExists === undefined) {
    try {
      require("fs").accessSync(TERMUX_EXEC_LIB);
      _termuxExecExists = true;
    } catch {
      _termuxExecExists = false;
    }
  }
  return _termuxExecExists;
}

if (termuxExecExists()) {
  process.env.LD_PRELOAD = TERMUX_EXEC_LIB;
  const cp = require("child_process");
  const _spawn = cp.spawn;
  cp.spawn = function spawn(cmd, args, opts) {
    if (opts && typeof opts === "object" && opts.env && !opts.env.LD_PRELOAD) {
      opts.env.LD_PRELOAD = TERMUX_EXEC_LIB;
    }
    return _spawn.apply(this, arguments);
  };
}
