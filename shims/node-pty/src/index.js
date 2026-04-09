const { spawn: zigSpawn, open: zigOpen } = require("zigpty");

// Prevent SIGINT from killing the pty host child process.
// The native node-pty runs in-process as a C++ addon and is immune to SIGINT,
// but this JS shim runs in a forked utility process that inherits the signal.
// The parent (VS Code server) manages the lifecycle via IPC — if we let SIGINT
// through, the pty host dies and VS Code logs "ptyHost terminated unexpectedly".
if (!process.listenerCount("SIGINT")) {
  process.on("SIGINT", () => {});
}

// -- Shim --

function wrapPty(pty) {
  return {
    get pid() {
      return pty.pid;
    },
    get cols() {
      return pty.cols;
    },
    get rows() {
      return pty.rows;
    },
    get process() {
      try {
        return pty.process;
      } catch (err) {
        console.error(`[node-pty] process getter error: pid=${pty.pid}`, err);
        return "";
      }
    },
    get handleFlowControl() {
      return pty.handleFlowControl;
    },
    set handleFlowControl(value) {
      pty.handleFlowControl = value;
    },
    onData: (listener) =>
      pty.onData((data) => listener(typeof data === "string" ? data : data.toString("utf8"))),
    onExit: (listener) => pty.onExit(listener),
    resize: (columns, rows, pixelSize) => pty.resize(columns, rows, pixelSize),
    clear: () => pty.clear(),
    write: (data) => pty.write(typeof data === "string" ? data : data.toString("utf8")),
    kill: (signal) => {
      console.error(`[node-pty] kill: pid=${pty.pid}, signal=${signal}`);
      pty.kill(signal);
    },
    pause: () => pty.pause(),
    resume: () => pty.resume(),
  };
}

function spawn(file, args, options) {
  // console.error(
  //   `[node-pty] spawn: file=${file}, args=${JSON.stringify(args)}, cwd=${options.cwd}, uid=${options.uid}, gid=${options.gid}`,
  // );
  // if (options.env) {
  //   console.error(`[node-pty] env.PATH=${options.env.PATH}`);
  //   console.error(`[node-pty] env.SHELL=${options.env.SHELL}`);
  //   console.error(`[node-pty] env.HOME=${options.env.HOME}`);
  //   console.error(`[node-pty] env.TERM=${options.env.TERM}`);
  //   console.error(`[node-pty] env.LD_LIBRARY_PATH=${options.env.LD_LIBRARY_PATH}`);
  //   console.error(`[node-pty] env.LD_PRELOAD=${options.env.LD_PRELOAD}`);
  // }
  const zigOptions = {
    name: options.name,
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
    encoding: options.encoding ?? undefined,
    handleFlowControl: options.handleFlowControl,
    flowControlPause: options.flowControlPause,
    flowControlResume: options.flowControlResume,
  };

  if ("uid" in options) {
    zigOptions.uid = options.uid;
    zigOptions.gid = options.gid;
  }

  const normalizedArgs = typeof args === "string" ? args.split(" ") : args;
  try {
    const t0 = Date.now();
    const pty = zigSpawn(file, normalizedArgs, zigOptions);
    console.error(`[node-pty] spawned pid=${pty.pid} in ${Date.now() - t0}ms`);
    pty.onExit((e) =>
      console.error(
        `[node-pty] exit: pid=${pty.pid}, code=${e.exitCode}, signal=${e.signal}, alive=${Date.now() - t0}ms`,
      ),
    );
    return wrapPty(pty);
  } catch (err) {
    console.error(`[node-pty] spawn error:`, err);
    throw err;
  }
}

/** @deprecated Use `spawn` instead. */
const fork = spawn;

/** @deprecated Use `spawn` instead. */
const createTerminal = spawn;

function open(options) {
  return zigOpen(options);
}

module.exports = { spawn, fork, createTerminal, open };
