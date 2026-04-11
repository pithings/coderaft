# Shims

This directory contains workspace packages that replace native/heavy dependencies pulled in by `code-server` and VS Code with lean pure-JS or prebuilt alternatives. They are wired in via `pnpm.overrides` in the root [`package.json`](../package.json), so even nested dependencies resolve to these local stubs.

## Shim Packages

- [`vsda/`](./vsda/) — JS stub for [`vsda`](https://www.npmjs.com/package/vsda) (VS Device Auth native module).
- [`github-copilot/`](./github-copilot/) — Shim for [`@github/copilot`](https://www.npmjs.com/package/@github/copilot), dropping its native clipboard/auth binaries (previously ~77% of total native binary size).
- [`github-copilot-sdk/`](./github-copilot-sdk/) — Shim for [`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk).
- [`node-pty/`](./node-pty/) — Replaces [`node-pty`](https://github.com/microsoft/node-pty) with [`zigpty`](https://github.com/pithings/zigpty), a Zig-based PTY with prebuilt binaries for all major platforms.
- [`spdlog/`](./spdlog/) — No-op JS shim for [`@vscode/spdlog`](https://github.com/vscode-spdlog/spdlog) (native C++ logger), replaced with a simple JS logger.
- [`vscode-deviceid/`](./vscode-deviceid/) — Pure JS shim for [`@vscode/deviceid`](https://github.com/Microsoft/vscode-deviceid) (native C++ Windows registry addon for device ID). Uses Node.js built-in `crypto.randomUUID()` and filesystem storage — no native binaries needed.
- [`vscode-fs-copyfile/`](./vscode-fs-copyfile/) — JS shim for [`@vscode/fs-copyfile`](https://www.npmjs.com/package/@vscode/fs-copyfile) (native macOS APFS `fclonefileat` addon, required by the bundled `git` extension). Delegates to Node's built-in `fs.copyFile` / `fs.cp`. Bundled `require` in the git extension's `dist/main.js`, undeclared upstream.
- [`vscode-native-watchdog/`](./vscode-native-watchdog/) — No-op JS shim for [`@vscode/native-watchdog`](https://www.npmjs.com/package/@vscode/native-watchdog) (native C++ parent-pid liveness monitor for the extension host). Orphan cleanup is left to the process supervisor and IPC channel close.
- [`vscode-ripgrep/`](./vscode-ripgrep/) — Replaces [`@vscode/ripgrep`](https://www.npmjs.com/package/@vscode/ripgrep) (downloads platform-specific ripgrep binary at postinstall) with [`ripgrep`](https://github.com/pithings/ripgrep-node), a WebAssembly-based ripgrep that works across all platforms without native binaries.
- [`parcel-watcher/`](./parcel-watcher/) — Replaces [`@parcel/watcher`](https://github.com/parcel-bundler/watcher) (native C++ file watcher with node-gyp) with Node.js built-in `fs.watch` (recursive mode). Trades snapshot/history features for zero native binaries.
- [`fsevents/`](./fsevents/) — No-op shim for [`fsevents`](https://github.com/fsevents/fsevents) (macOS-only native FSEvents binding). Consumers already fall back to `fs.watch`/polling when unavailable.
- [`windows-process-tree/`](./windows-process-tree/) — Replaces [`@vscode/windows-process-tree`](https://github.com/nicedoc/windows-process-tree) (Windows-only native addon) with cross-platform process inspection using `ps` (Unix) / `wmic` (Windows).
- [`vscode-windows-registry/`](./vscode-windows-registry/) — Stub for [`@vscode/windows-registry`](https://www.npmjs.com/package/@vscode/windows-registry) (native C++ registry addon with unbuilt `binding.gyp`). Only used by VS Code's telemetry/machine-id code (`GetStringRegKey("HKEY_LOCAL_MACHINE", …, "MachineId")`); callers already handle errors and fall back to defaults.
- [`argon2/`](./argon2/) — Replaces [`argon2`](https://github.com/ranisalt/node-argon2) (native C binding) with Node.js `crypto.scrypt`. Encodes/decodes PHC-format hashes for compatibility with existing stored passwords.
- [`vscode-proxy-agent/`](./vscode-proxy-agent/) — No-op shim for [`@vscode/proxy-agent`](https://github.com/microsoft/vscode-proxy-agent) (proxy resolver with heavy deps: `undici`, `socks-proxy-agent`, `http-proxy-agent`, etc.). Passes through Node.js native `http`/`https`/`net`/`tls` unmodified. Users behind a proxy can rely on `HTTP_PROXY`/`HTTPS_PROXY` env vars.
- [`1ds-core-js/`](./1ds-core-js/) — No-op shim for [`@microsoft/1ds-core-js`](https://www.npmjs.com/package/@microsoft/1ds-core-js) (Microsoft 1DS telemetry core). Silently drops all telemetry events. Also eliminates transitive deps: `@microsoft/applicationinsights-core-js`, `@microsoft/dynamicproto-js`, `@microsoft/applicationinsights-shims`.
- [`1ds-post-js/`](./1ds-post-js/) — No-op shim for [`@microsoft/1ds-post-js`](https://www.npmjs.com/package/@microsoft/1ds-post-js) (Microsoft 1DS telemetry transport). Silently drops all telemetry posts.
- [`kerberos/`](./kerberos/) — Shim for [`kerberos`](https://github.com/mongodb-js/kerberos) (native GSSAPI/SSPI binding via `node-gyp`, used by VS Code's built-in Negotiate proxy authentication). Loaded via dynamic `import("kerberos")` from `server-main.js` / `extensionHostProcess.js`; since [`@vscode/proxy-agent`](./vscode-proxy-agent/) is itself a no-op shim, this path is effectively dead. The shim throws from `initializeClient` so callers surface a clear error instead of a malformed token. Users behind a proxy should set `HTTP_PROXY` / `HTTPS_PROXY`.

Additionally, `coderaft` uses a minimal Node.js `http` server instead of the Express-based stack from upstream `coder/code-server` (dropping `express`, `compression`, `cookie-parser`, `http-proxy`, `httpolyglot`, `qs`, and friends), cutting startup time and dependency weight.

## pnpm Overrides

The mappings configured in root [`package.json`](../package.json):

| Package                        | Override                         |
| ------------------------------ | -------------------------------- |
| `vsda`                         | `shims/vsda/`                    |
| `@github/copilot`              | `shims/github-copilot/`          |
| `@github/copilot-sdk`          | `shims/github-copilot-sdk/`      |
| `node-pty`                     | `shims/node-pty/`                |
| `@vscode/spdlog`               | `shims/spdlog/`                  |
| `@vscode/fs-copyfile`          | `shims/vscode-fs-copyfile/`      |
| `@vscode/deviceid`             | `shims/vscode-deviceid/`         |
| `@vscode/native-watchdog`      | `shims/vscode-native-watchdog/`  |
| `@vscode/ripgrep`              | `shims/vscode-ripgrep/`          |
| `@parcel/watcher`              | `shims/parcel-watcher/`          |
| `fsevents`                     | `shims/fsevents/`                |
| `@vscode/windows-process-tree` | `shims/windows-process-tree/`    |
| `@vscode/windows-registry`     | `shims/vscode-windows-registry/` |
| `argon2`                       | `shims/argon2/`                  |
| `@vscode/proxy-agent`          | `shims/vscode-proxy-agent/`      |
| `@microsoft/1ds-core-js`       | `shims/1ds-core-js/`             |
| `@microsoft/1ds-post-js`       | `shims/1ds-post-js/`             |
| `kerberos`                     | `shims/kerberos/`                |

The `sync-deps` script does not need special handling for these — overrides work at the pnpm resolution level.

## Native (NAPI) Dependencies

Remaining `.node` binaries in `lib/node_modules` (after shimming):

| Package                          | Size  | Arch                           | Build Type |
| -------------------------------- | ----- | ------------------------------ | ---------- |
| `zigpty` (replaces `node-pty`)   | ~220K | linux/darwin/win32 x x64/arm64 | prebuilds  |
| `ms-vscode.js-debug` (ext)       | ~460K | win32-x64 + win32-arm64        | bundled    |
| `microsoft-authentication` (ext) | ~400K | linux-x64 only                 | bundled    |

All other native packages (`@github/copilot`, `@vscode/spdlog`, `@vscode/native-watchdog`, `@vscode/windows-process-tree`, `@vscode/windows-registry`, `@vscode/deviceid`, `@parcel/watcher`, `fsevents`, `argon2`, `kerberos`) are fully shimmed with zero native binaries.

### Notes

- `zigpty` ships prebuilds for 8 platform/arch combinations; only one is used at runtime
- `ms-vscode.js-debug` and `microsoft-authentication` are VS Code bundled extensions with platform-specific binaries that cannot be shimmed
