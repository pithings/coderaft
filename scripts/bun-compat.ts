// Pack-time source rewrites that let the bundled VS Code server run under Bun.
//
// Applied by scripts/pack.ts to the copies of files that go into
// lib/code.tar.zst. The installed tree under lib/node_modules is never
// modified: patches/code-server.patch is applied there and reversed by
// scripts/patch.ts, and since the bundles are minified to a single line, any
// extra in-place edit to a patched file (server-main.js) would make that patch
// stop applying in either direction.
//
// ## `module.registerHooks`
//
// VS Code (since ~1.140) uses Node's synchronous module hooks API
// (`module.registerHooks`), which Bun does not implement. Two shapes show up:
//
//   1. A static named import, e.g. in server-main.js, server-cli.js and
//      bootstrap-fork.js:
//
//        import{createRequire as b0,isBuiltin as b6,registerHooks as S6}from"node:module";
//
//      ESM named imports are checked when modules are linked, so Bun refuses to
//      load the file at all ("Export named 'registerHooks' not found in module
//      'node:module'") even though the call site is Electron-only. This is
//      rewritten into a namespace import plus a lazy wrapper, which defers the
//      lookup to call time.
//
//   2. A member call on a namespace import, e.g. in extensionHostProcess.js:
//
//        m=cK.registerHooks({resolve:...});this._store.add(j(()=>m.deregister()))
//
//      This loads fine but throws a TypeError under Bun when the extension
//      host installs its module interceptor. It is rewritten to fall back to a
//      no-op that returns a `{ deregister() {} }` handle. On Node the real API is
//      always used. Under Bun the hook is simply absent: CJS extensions are
//      unaffected (VS Code's `Module._load` interceptor still serves `vscode`),
//      but ESM extensions that `import "vscode"` will not resolve it.
//
// Variable names are minified per bundle, so both rewrites match by shape.

/** Expression evaluated in place of a missing `registerHooks`. */
const NOOP_REGISTER_HOOKS = "(()=>({deregister(){}}))";

// `import{a as b,registerHooks as c}from"node:module";`. Specifiers must not
// contain braces, which keeps the match inside a single import statement.
const NAMED_IMPORT_RE = /import\s*\{([^{}]*)\}\s*from\s*(["'])node:module\2\s*;?/g;
const REGISTER_HOOKS_SPEC_RE = /^registerHooks(?:\s+as\s+([\w$]+))?$/;

// `ns.registerHooks(` or `a.b.registerHooks(`. The lookbehind stops the match
// from starting partway through a longer member chain or identifier.
const MEMBER_CALL_RE = /(?<![\w$.])((?:[\w$]+\.)*[\w$]+)\.registerHooks\(/g;

/** Rewrite `code` so it loads and runs on runtimes without `module.registerHooks`. Idempotent. */
export function rewriteRegisterHooks(code: string): string {
  if (!code.includes("registerHooks")) return code;
  let nsCounter = 0;

  code = code.replace(NAMED_IMPORT_RE, (full, specs: string) => {
    const list = specs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const idx = list.findIndex((s) => REGISTER_HOOKS_SPEC_RE.test(s));
    if (idx === -1) return full;
    const local = list[idx]!.match(REGISTER_HOOKS_SPEC_RE)![1] ?? "registerHooks";
    list.splice(idx, 1);
    const ns = `__coderaftNodeModule${nsCounter++}`;
    const rest = list.length > 0 ? `import{${list.join(",")}}from"node:module";` : "";
    // `var` (not `const`) avoids a TDZ: the original import binding was hoisted.
    return `${rest}import*as ${ns} from"node:module";var ${local}=(...a)=>${ns}.registerHooks(...a);`;
  });

  return code.replace(
    MEMBER_CALL_RE,
    (_, obj: string) => `(${obj}.registerHooks||${NOOP_REGISTER_HOOKS})(`,
  );
}

/** Whether a file in the archive should go through {@link rewriteRegisterHooks}. */
export function isRewriteCandidate(relPath: string): boolean {
  return /\.[cm]?js$/.test(relPath);
}
