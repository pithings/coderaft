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
      return pty.process;
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
    kill: (signal) => pty.kill(signal),
    pause: () => pty.pause(),
    resume: () => pty.resume(),
  };
}

function spawn(file, args, options) {
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
  return wrapPty(zigSpawn(file, normalizedArgs, zigOptions));
}

/** @deprecated Use `spawn` instead. */
const fork = spawn;

/** @deprecated Use `spawn` instead. */
const createTerminal = spawn;

function open(options) {
  return zigOpen(options);
}

module.exports = { spawn, fork, createTerminal, open };
