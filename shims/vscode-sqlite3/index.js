// Shim for `@vscode/sqlite3` — replaces the native SQLite binding (bundled C
// source + node-gyp build).
//
// Wraps Node.js' built-in synchronous `node:sqlite` (stable in Node 24+) in
// the async callback / EventEmitter API of node-sqlite3. The bundle loads it
// via dynamic `import("@vscode/sqlite3")` (reading `.default`) from:
//
// - `server-main.js` — the storage service backing `state.vscdb` (global and
//   workspace state; since VS Code 4.146 / code-server 4.146). Uses
//   `verbose()`, `Database` events (`on("error"|"trace")`), `serialize()`,
//   `prepare()` → `Statement.run/on/removeListener/finalize`, plus
//   `exec/run/get/all/close`, and checks `err.code === "SQLITE_CANTOPEN"`.
// - `vs/platform/agentHost/node/agentHostMain.js` — the agent-host session
//   database. Also opens read-only via `new Database(path, OPEN_READONLY, cb)`.
//
// node:sqlite is synchronous, so `serialize()` is trivially satisfied and
// callbacks are deferred to a microtask to keep node-sqlite3's async contract.

const { EventEmitter } = require("node:events");

const OPEN_READONLY = 0x00000001;
const OPEN_READWRITE = 0x00000002;
const OPEN_CREATE = 0x00000004;

let DatabaseSync;
function loadDatabaseSync() {
  return (DatabaseSync ??= globalThis.process.getBuiltinModule("node:sqlite").DatabaseSync);
}

// node:sqlite throws `ERR_SQLITE_ERROR` with the numeric primary result code in
// `errcode`; node-sqlite3 exposes the symbolic name in `code`.
const SQLITE_CODES = {
  1: "SQLITE_ERROR",
  2: "SQLITE_INTERNAL",
  3: "SQLITE_PERM",
  4: "SQLITE_ABORT",
  5: "SQLITE_BUSY",
  6: "SQLITE_LOCKED",
  7: "SQLITE_NOMEM",
  8: "SQLITE_READONLY",
  9: "SQLITE_INTERRUPT",
  10: "SQLITE_IOERR",
  11: "SQLITE_CORRUPT",
  12: "SQLITE_NOTFOUND",
  13: "SQLITE_FULL",
  14: "SQLITE_CANTOPEN",
  15: "SQLITE_PROTOCOL",
  16: "SQLITE_EMPTY",
  17: "SQLITE_SCHEMA",
  18: "SQLITE_TOOBIG",
  19: "SQLITE_CONSTRAINT",
  20: "SQLITE_MISMATCH",
  21: "SQLITE_MISUSE",
  22: "SQLITE_NOLFS",
  23: "SQLITE_AUTH",
  24: "SQLITE_FORMAT",
  25: "SQLITE_RANGE",
  26: "SQLITE_NOTADB",
};

function toSqliteError(e) {
  if (e && typeof e === "object" && typeof e.errcode === "number") {
    const name = SQLITE_CODES[e.errcode & 0xff];
    if (name) {
      e.errno = e.errcode & 0xff;
      e.code = name;
    }
  }
  return e;
}

// node-sqlite3 accepts `(sql, ...params, cb)`, `(sql, [params], cb)` and
// `(sql, {named}, cb)`. Split trailing callback from bind parameters.
function splitArgs(args) {
  const list = [...args];
  const callback = typeof list[list.length - 1] === "function" ? list.pop() : undefined;
  let params;
  if (list.length === 0) params = [];
  else if (list.length === 1 && Array.isArray(list[0])) params = list[0];
  else if (list.length === 1 && list[0] !== null && typeof list[0] === "object") params = [list[0]];
  else params = list;
  return { params, callback };
}

// Deliver `err` to the callback, or emit it as an "error" event when no
// callback was given (node-sqlite3 semantics). Unlike node-sqlite3, an
// unhandled error is swallowed rather than thrown when nobody listens.
function settle(emitter, callback, thisArg, err, ...results) {
  queueMicrotask(() => {
    if (typeof callback === "function") callback.call(thisArg, err, ...results);
    else if (err && emitter.listenerCount("error") > 0) emitter.emit("error", err);
  });
}

class Statement extends EventEmitter {
  constructor(db, sql, callback) {
    super();
    this._db = db;
    this.sql = sql;
    let err = null;
    try {
      this._stmt = db._db.prepare(sql);
    } catch (e) {
      err = toSqliteError(e);
    }
    this._prepareError = err;
    settle(this, callback, this, err);
  }

  _exec(method, args) {
    const { params, callback } = splitArgs(args);
    let err = this._prepareError;
    let result;
    if (!err) {
      try {
        result = this._stmt[method](...params);
      } catch (e) {
        err = toSqliteError(e);
      }
    }
    return { err, result, callback };
  }

  run(...args) {
    const { err, result, callback } = this._exec("run", args);
    const ctx = {
      changes: result ? Number(result.changes) : 0,
      lastID: result ? Number(result.lastInsertRowid) : 0,
    };
    settle(this, callback, ctx, err);
    return this;
  }

  get(...args) {
    const { err, result, callback } = this._exec("get", args);
    settle(this, callback, this, err, result);
    return this;
  }

  all(...args) {
    const { err, result, callback } = this._exec("all", args);
    settle(this, callback, this, err, result);
    return this;
  }

  // node:sqlite statements are reset on every call and freed by GC.
  reset(callback) {
    settle(this, callback, this, null);
    return this;
  }

  finalize(callback) {
    this._stmt = undefined;
    // Errors reach finalize's callback as an argument, never as an event.
    queueMicrotask(() => typeof callback === "function" && callback.call(this, null));
    return this._db;
  }
}

class Database extends EventEmitter {
  constructor(path, mode, callback) {
    super();
    if (typeof mode === "function") {
      callback = mode;
      mode = OPEN_READWRITE | OPEN_CREATE;
    }
    this.filename = path;
    let err = null;
    try {
      const readOnly = typeof mode === "number" && (mode & OPEN_READONLY) !== 0;
      this._db = new (loadDatabaseSync())(path, { readOnly });
    } catch (e) {
      err = toSqliteError(e);
    }
    queueMicrotask(() => {
      if (typeof callback === "function") callback.call(this, err);
      else if (err && this.listenerCount("error") > 0) this.emit("error", err);
      if (!err) this.emit("open");
    });
  }

  _trace(sql) {
    if (this.listenerCount("trace") > 0) this.emit("trace", sql);
  }

  // node:sqlite executes synchronously, so every call is already serialized.
  serialize(callback) {
    if (typeof callback === "function") callback();
    return this;
  }

  parallelize(callback) {
    if (typeof callback === "function") callback();
    return this;
  }

  // Bind parameters passed to prepare() itself are not supported (unused by
  // VS Code); pass them to run()/get()/all() instead.
  prepare(sql, ...args) {
    this._trace(sql);
    const callback = typeof args[args.length - 1] === "function" ? args.pop() : undefined;
    return new Statement(this, sql, callback);
  }

  exec(sql, callback) {
    this._trace(sql);
    let err = null;
    try {
      this._db.exec(sql);
    } catch (e) {
      err = toSqliteError(e);
    }
    settle(this, callback, this, err);
    return this;
  }

  run(sql, ...args) {
    this._trace(sql);
    const { params, callback } = splitArgs(args);
    const ctx = { changes: 0, lastID: 0 };
    let err = null;
    try {
      const result = this._db.prepare(sql).run(...params);
      ctx.changes = Number(result.changes);
      ctx.lastID = Number(result.lastInsertRowid);
    } catch (e) {
      err = toSqliteError(e);
    }
    settle(this, callback, ctx, err);
    return this;
  }

  get(sql, ...args) {
    this._trace(sql);
    const { params, callback } = splitArgs(args);
    let err = null;
    let row;
    try {
      row = this._db.prepare(sql).get(...params);
    } catch (e) {
      err = toSqliteError(e);
    }
    settle(this, callback, this, err, row);
    return this;
  }

  all(sql, ...args) {
    this._trace(sql);
    const { params, callback } = splitArgs(args);
    let err = null;
    let rows;
    try {
      rows = this._db.prepare(sql).all(...params);
    } catch (e) {
      err = toSqliteError(e);
    }
    settle(this, callback, this, err, rows);
    return this;
  }

  close(callback) {
    let err = null;
    try {
      if (this._db?.isOpen !== false) this._db?.close();
    } catch (e) {
      err = toSqliteError(e);
    }
    queueMicrotask(() => {
      if (typeof callback === "function") callback.call(this, err);
      else if (err && this.listenerCount("error") > 0) this.emit("error", err);
      if (!err) this.emit("close");
    });
    return this;
  }
}

const sqlite3 = {
  Database,
  Statement,
  OPEN_READONLY,
  OPEN_READWRITE,
  OPEN_CREATE,
  verbose() {
    return sqlite3;
  },
};

module.exports = sqlite3;
