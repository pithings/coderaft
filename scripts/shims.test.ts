// Behavioural tests for shims whose API surface VS Code's bundles depend on.
//
// The shims are linked into lib/node_modules, so they are resolved from lib/
// exactly as the bundled VS Code would resolve them.

import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(join(import.meta.dirname!, "../lib/package.json"));
const importShim = (spec: string) => import(pathToFileURL(require.resolve(spec)).href);

describe("@vscode/sqlite3 shim", async () => {
  // VS Code reads `.default` off the dynamic import (CJS interop).
  const sqlite3 = (await importShim("@vscode/sqlite3")).default;
  const dir = mkdtempSync(join(tmpdir(), "coderaft-sqlite3-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const p = <T = void>(fn: (cb: (err: Error | null, v?: T) => void) => void) =>
    new Promise<T>((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v as T))));

  // Mirrors the call sequence of VS Code's SQLiteStorageDatabase (server-main.js).
  it("supports the storage service's call sequence", async () => {
    const path = join(dir, "state.vscdb");
    const Database = sqlite3.verbose().Database;
    const errors: unknown[] = [];
    const db = await new Promise<any>((resolve, reject) => {
      const d = new Database(path, (err: Error | null) => {
        if (err) return reject(err);
        d.exec(
          "PRAGMA user_version = 1;CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);PRAGMA journal_mode=WAL;",
          (e: Error | null) => (e ? reject(e) : resolve(d)),
        );
      });
      d.on("error", (e: unknown) => errors.push(e));
    });

    // transaction(): serialize + BEGIN / prepared statements / END with callback
    await new Promise<void>((resolve, reject) => {
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare(
          "INSERT INTO ItemTable VALUES (?,?),(?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE value != excluded.value",
        );
        const onError = (e: unknown) => errors.push(e);
        stmt.on("error", onError);
        stmt.run(["a", "1", "b", "2"]);
        stmt.finalize((e: Error | null) => {
          if (e) errors.push(e);
          stmt.removeListener("error", onError);
        });
        db.run("END TRANSACTION", (e: Error | null) => (e ? reject(e) : resolve()));
      });
    });

    const rows = await p<{ key: string; value: string }[]>((cb) =>
      db.all("SELECT * FROM ItemTable", cb),
    );
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(await p<any>((cb) => db.get("PRAGMA quick_check", cb))).toMatchObject({
      quick_check: "ok",
    });
    expect(errors).toEqual([]);
    await p((cb) => db.close(cb));
  });

  it("reports statement errors as events when no callback is given", async () => {
    const db = new sqlite3.Database(":memory:");
    const stmt = db.prepare("INSERT INTO missing VALUES (?)");
    const err = await new Promise<any>((resolve) => stmt.on("error", resolve));
    expect(err.code).toBe("SQLITE_ERROR");
    await p((cb) => db.close(cb));
  });

  it("maps open failures to SQLITE_CANTOPEN", async () => {
    const err = await new Promise<any>((resolve) => {
      new sqlite3.Database(join(dir, "no/such/dir/x.db"), resolve);
    });
    expect(err.code).toBe("SQLITE_CANTOPEN");
  });

  it("accepts an open mode before the callback (agent host read-only path)", async () => {
    const path = join(dir, "ro.db");
    const rw = await new Promise<any>((resolve, reject) => {
      const d = new sqlite3.Database(path, (e: Error | null) => (e ? reject(e) : resolve(d)));
    });
    await p((cb) => rw.exec("CREATE TABLE t (x)", cb));
    await p((cb) => rw.close(cb));

    const ro = await new Promise<any>((resolve, reject) => {
      const d = new sqlite3.Database(path, sqlite3.OPEN_READONLY, (e: Error | null) =>
        e ? reject(e) : resolve(d),
      );
    });
    const err = await new Promise<any>((resolve) => ro.run("INSERT INTO t VALUES (1)", resolve));
    expect(err.code).toBe("SQLITE_READONLY");
    await p((cb) => ro.close(cb));
  });
});

describe("@github/copilot-sdk shim", () => {
  // Named ESM imports in server-main.js / agentHostMain.js are resolved at link
  // time — a missing one aborts server startup.
  it("provides every name VS Code imports", async () => {
    const sdk = await importShim("@github/copilot-sdk");
    for (const name of [
      "CopilotClient",
      "RuntimeConnection",
      "CopilotRequestHandler",
      "createAttributedPermissionResult",
    ]) {
      expect(sdk, name).toHaveProperty(name);
    }
    expect(sdk.RuntimeConnection.forStdio({ path: "/x" })).toEqual({ kind: "stdio", path: "/x" });
    class Handler extends sdk.CopilotRequestHandler {}
    expect(new Handler()).toBeInstanceOf(sdk.CopilotRequestHandler);
  });
});
