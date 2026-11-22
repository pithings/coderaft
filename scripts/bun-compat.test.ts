import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { rewriteRegisterHooks } from "./bun-compat.ts";

// Matches a static named import of `registerHooks` from node:module, the shape
// Bun refuses to link.
const NAMED_IMPORT_OF_REGISTER_HOOKS =
  /import\s*\{[^{}]*\bregisterHooks\b[^{}]*\}\s*from\s*["']node:module["']/;
// A bare `<ident>.registerHooks(` call without the fallback.
const UNGUARDED_MEMBER_CALL = /[\w$]\.registerHooks\(/;

describe("rewriteRegisterHooks", () => {
  it("rewrites an aliased named import and keeps the other specifiers", () => {
    const src = `import{createRequire as b0,isBuiltin as b6,registerHooks as S6}from"node:module";S6({});`;
    const out = rewriteRegisterHooks(src);
    expect(out).not.toMatch(NAMED_IMPORT_OF_REGISTER_HOOKS);
    expect(out).toContain(`import{createRequire as b0,isBuiltin as b6}from"node:module";`);
    expect(out).toContain(`import*as __coderaftNodeModule0 from"node:module";`);
    expect(out).toContain(
      `var S6=(...a)=>(__coderaftNodeModule0.registerHooks||(()=>({deregister(){}})))(...a);`,
    );
  });

  it("handles registerHooks as the only, first, or unaliased specifier", () => {
    for (const src of [
      `import{registerHooks as r}from"node:module";`,
      `import { registerHooks as r, createRequire as c } from 'node:module'`,
      `import{registerHooks}from"node:module";`,
    ]) {
      const out = rewriteRegisterHooks(src);
      expect(out).not.toMatch(NAMED_IMPORT_OF_REGISTER_HOOKS);
      expect(out).toMatch(/var (r|registerHooks)=\(\.\.\.a\)=>/);
    }
  });

  it("leaves node:module imports without registerHooks alone", () => {
    const src = `import{createRequire as h6}from"node:module";`;
    expect(rewriteRegisterHooks(src)).toBe(src);
  });

  it("guards member calls with a no-op fallback", () => {
    const src = `m=cK.registerHooks({resolve:f});x=a.b.registerHooks(o);`;
    const out = rewriteRegisterHooks(src);
    expect(out).toBe(
      `m=(cK.registerHooks||(()=>({deregister(){}})))({resolve:f});` +
        `x=(a.b.registerHooks||(()=>({deregister(){}})))(o);`,
    );
  });

  it("is idempotent", () => {
    const src = `import{registerHooks as r}from"node:module";m=cK.registerHooks({});`;
    const once = rewriteRegisterHooks(src);
    expect(rewriteRegisterHooks(once)).toBe(once);
  });

  it("produces code that loads and runs without module.registerHooks", async () => {
    const src =
      `import{createRequire as c,registerHooks as r}from"node:module";` +
      `export const h=r({});export const t=typeof c;`;
    const out = rewriteRegisterHooks(src);
    // On Node the real API runs; either way the module must link and return a handle.
    const mod = await import(`data:text/javascript,${encodeURIComponent(out)}`);
    expect(typeof mod.h.deregister).toBe("function");
    expect(mod.t).toBe("function");
  });
});

describe("bundled VS Code after rewrite", () => {
  const require = createRequire(import.meta.url);
  const codeServerRoot = dirname(
    require.resolve("code-server/package.json", { paths: [join(import.meta.dirname!, "../lib")] }),
  );
  const files = [
    "lib/vscode/out/server-main.js",
    "lib/vscode/out/server-cli.js",
    "lib/vscode/out/bootstrap-fork.js",
    "lib/vscode/out/vs/workbench/api/node/extensionHostProcess.js",
  ];
  for (const rel of files) {
    it(`leaves no Bun-incompatible registerHooks use in ${rel.split("/").pop()}`, () => {
      const src = readFileSync(join(codeServerRoot, rel), "utf8");
      // Guard against a silent no-op: the source must still use the API at all.
      expect(src).toContain("registerHooks");
      const out = rewriteRegisterHooks(src);
      expect(out).not.toMatch(NAMED_IMPORT_OF_REGISTER_HOOKS);
      expect(out).not.toMatch(UNGUARDED_MEMBER_CALL);
    });
  }
});
