# code-server

Custom VS Code server build with bundled dependencies.

## Project Structure

- `lib/` — Main dependency package, pulls in `code-server@^4.114.0` and all required VS Code native/runtime deps
- `shims/` — Workspace shim packages replacing native deps (pnpm overrides). See [shims/README.md](./shims/README.md) for the full list, pnpm override mappings, and native binary breakdown.
