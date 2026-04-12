// Minimal @vscode/spdlog shim — replaces native C++ logger with console output.

const version = 0;

const LogLevel = {
  Trace: 0,
  Debug: 1,
  Info: 2,
  Warning: 3,
  Error: 4,
  Critical: 5,
  Off: 6,
};

let globalLevel = LogLevel.Info;

const colorsEnabled =
  (process.stdout.isTTY || process.env.FORCE_COLOR !== undefined) &&
  process.env.NO_COLOR === undefined;

const c = (code) => (s) => (colorsEnabled ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c("2");
const gray = c("90");
const cyan = c("36");
const green = c("32");
const yellow = c("33");
const red = c("31");
const bgRed = c("41;97");

const LEVEL_STYLES = {
  [LogLevel.Trace]: { label: "trace", color: gray, method: "debug" },
  [LogLevel.Debug]: { label: "debug", color: cyan, method: "debug" },
  [LogLevel.Info]: { label: "info ", color: green, method: "info" },
  [LogLevel.Warning]: { label: "warn ", color: yellow, method: "warn" },
  [LogLevel.Error]: { label: "error", color: red, method: "error" },
  [LogLevel.Critical]: { label: "crit ", color: bgRed, method: "error" },
};

class Logger {
  constructor(_loggerType, name, _filename, _filesize, _filecount) {
    this.name = name;
    this.level = globalLevel;
  }
  _log(level, message) {
    if (level < this.level) return;
    const trimmed = String(message).trim();
    if (!trimmed) return;
    const style = LEVEL_STYLES[level];
    console[style.method](`${style.color(style.label)} ${dim(`[${this.name}]`)} ${trimmed}`);
  }
  trace(message) {
    this._log(LogLevel.Trace, message);
  }
  debug(message) {
    this._log(LogLevel.Debug, message);
  }
  info(message) {
    this._log(LogLevel.Info, message);
  }
  warn(message) {
    this._log(LogLevel.Warning, message);
  }
  error(message) {
    this._log(LogLevel.Error, message);
  }
  critical(message) {
    this._log(LogLevel.Critical, message);
  }
  getLevel() {
    return this.level;
  }
  setLevel(level) {
    this.level = level;
  }
  setPattern(_pattern) {}
  clearFormatters() {}
  flush() {}
  drop() {}
}

function setLevel(level) {
  globalLevel = level;
}

function setFlushOn(_level) {}

async function createRotatingLogger(name, filename, filesize, filecount) {
  return new Logger("rotating", name, filename, filesize, filecount);
}

async function createAsyncRotatingLogger(name, filename, filesize, filecount) {
  return new Logger("rotating_async", name, filename, filesize, filecount);
}

module.exports = {
  version,
  setLevel,
  setFlushOn,
  createRotatingLogger,
  createAsyncRotatingLogger,
  LogLevel,
  Logger,
};
