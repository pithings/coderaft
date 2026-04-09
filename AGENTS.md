# coderaft

Custom VS Code server build with bundled dependencies.

## Project Structure

- `lib/` — Main dependency package, pulls in `code-server@^4.114.0` and all required VS Code native/runtime deps
- `shims/` — Workspace shim packages replacing native deps (pnpm overrides). See [shims/README.md](./shims/README.md) for the full list, pnpm override mappings, and native binary breakdown.
- `scripts/` — Dev/test scripts (docker, ssh, ESM deadlock repro)

## Shims: CJS vs ESM

Shims **must be CJS** (no `"type": "module"` in package.json) unless VS Code's bundled code imports them via ESM `import { ... } from "..."`.

- On Node 24+, `require()` of an ESM module goes through `syncLink` → `Atomics.wait()`. If VS Code's extension host has registered its custom ESM resolve hook (`module.register` + `MessageChannel`), this deadlocks: the main thread blocks waiting for the hook, but the hook needs the main thread to respond on `MessageChannel`.
- VS Code's bundled code uses `require()` for most deps (node-pty, ripgrep, spdlog, etc.) — these shims **must be CJS**.
- Exception: `@vscode/proxy-agent` is loaded via ESM `import { createHttpPatch, ... }` in VS Code's bundle — it **must stay ESM**, otherwise Node throws `SyntaxError: Named export not found`.

When adding a new shim, check how VS Code loads the original package (`require()` vs `import`) to decide CJS vs ESM.
