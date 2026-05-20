// Shim for `@vscode/sqlite3` — replaces the native SQLite binding (bundled C
// source + node-gyp build) used by VS Code's `agent-host` subcommand for its
// session database.
//
// Wraps Node.js' built-in synchronous `node:sqlite` (stable in Node 24+) in
// the async callback API expected by the bundled code. The bundle only loads
// this module via dynamic `import("@vscode/sqlite3")` from
// `vs/platform/agentHost/node/agentHostMain.js`, and only uses
// `Database`/`exec`/`run`/`get`/`all`/`close`.

let DatabaseSync;
function loadDatabaseSync() {
  return (DatabaseSync ??= globalThis.process.getBuiltinModule("node:sqlite").DatabaseSync);
}

function normalizeParams(params) {
  if (params === undefined || params === null) return [];
  return Array.isArray(params) ? params : [params];
}

class Database {
  constructor(path, callback) {
    let err = null;
    try {
      this._db = new (loadDatabaseSync())(path);
    } catch (e) {
      err = e;
    }
    if (typeof callback === "function") {
      queueMicrotask(() => callback.call(this, err));
    }
  }

  exec(sql, callback) {
    let err = null;
    try {
      this._db.exec(sql);
    } catch (e) {
      err = e;
    }
    if (typeof callback === "function") {
      queueMicrotask(() => callback.call(this, err));
    }
    return this;
  }

  run(sql, params, callback) {
    if (typeof params === "function") {
      callback = params;
      params = [];
    }
    const ctx = { changes: 0, lastID: 0 };
    let err = null;
    try {
      const result = this._db.prepare(sql).run(...normalizeParams(params));
      ctx.changes = Number(result.changes);
      ctx.lastID = Number(result.lastInsertRowid);
    } catch (e) {
      err = e;
    }
    if (typeof callback === "function") {
      queueMicrotask(() => callback.call(ctx, err));
    }
    return this;
  }

  get(sql, params, callback) {
    if (typeof params === "function") {
      callback = params;
      params = [];
    }
    let err = null;
    let row;
    try {
      row = this._db.prepare(sql).get(...normalizeParams(params));
    } catch (e) {
      err = e;
    }
    if (typeof callback === "function") {
      queueMicrotask(() => callback.call(this, err, row));
    }
    return this;
  }

  all(sql, params, callback) {
    if (typeof params === "function") {
      callback = params;
      params = [];
    }
    let err = null;
    let rows;
    try {
      rows = this._db.prepare(sql).all(...normalizeParams(params));
    } catch (e) {
      err = e;
    }
    if (typeof callback === "function") {
      queueMicrotask(() => callback.call(this, err, rows));
    }
    return this;
  }

  close(callback) {
    let err = null;
    try {
      this._db?.close();
    } catch (e) {
      err = e;
    }
    if (typeof callback === "function") {
      queueMicrotask(() => callback.call(this, err));
    }
    return this;
  }
}

module.exports = { Database, OPEN_READONLY: 1, OPEN_READWRITE: 2, OPEN_CREATE: 4 };
