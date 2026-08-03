# 🛶 coderaft

[![npm version](https://img.shields.io/npm/v/coderaft?color=blue)](https://npmx.dev/package/coderaft)
[![install size](https://packagephobia.com/badge?p=coderaft)](https://packagephobia.com/result?p=coderaft)

Run VS Code on any machine anywhere and access it in the browser.

A redistribution of [coder/code-server](https://github.com/coder/code-server) bundled into a single zero-dependency package (**~25 MB**). Native modules are shimmed with better alternatives ([zigpty](https://github.com/pithings/zigpty), [ripgrep-node](https://github.com/pithings/ripgrep-node), [...more](./shims/README.md)).

- **Installs in under a second** — no build tools, post-install scripts, or C/C++ toolchain needed
- **Fully portable** across platforms and architectures, unlike `code-server` (platform-specific binaries) and `openvscode-server` (Linux only)
- **Works everywhere** Node.js runs, including minimal images like `node:slim` and `node:alpine`

<details>
<summary>Detailed comparison</summary>

Compared to [`code-server`](https://www.npmjs.com/package/code-server) and [`openvscode-server`](https://github.com/gitpod-io/openvscode-server):

|                             | **coderaft** | **code-server**                           | **openvscode-server**            | **VS Code (DMG)**                |
| --------------------------- | ------------ | ----------------------------------------- | -------------------------------- | -------------------------------- |
| Distribution                | **npm**      | npm                                       | GitHub tarball (not on npm)      | Platform installer (DMG/EXE/deb) |
| Network download            | **31 MB**    | 273 MB                                    | ~73 MB                           | 155 MB                           |
| Install size on disk\*      | **32 MB**    | 776 MB                                    | 224 MB                           | 529 MB                           |
| Install time                | **~0.5s**    | ~15s                                      | ~1.2s                            | N/A                              |
| Dependencies                | **0**        | 462                                       | Bundled                          | Bundled                          |
| Build tools required        | **No**       | Yes (`node-gyp`, `gcc`, `make`, `python`) | No (pre-built)                   | No (pre-built)                   |
| Post-install scripts        | **None**     | Yes (`--unsafe-perm` required as root)    | N/A                              | N/A                              |
| Works on `node:slim` images | **Yes**      | No                                        | N/A (bundles own Node.js)        | N/A (desktop app)                |
| Fully portable              | **Yes**      | No (platform-specific compiled binaries)  | No (Linux only, x64/arm64/armhf) | No (platform-specific)           |

> Measured with `npm i` inside a fresh `node:22` Docker container.
>
> \*Before temporary decompression on first server start (~200 MB decompressed in a temp directory < 2s).

</details>

## CLI

Start an instance:

```sh
npx coderaft -o .
```

### Docker

```sh
docker run -it --rm -p 6063:6063 -v coderaft:/data ghcr.io/pithings/coderaft
```

Based on Alpine with Node.js LTS, bash, corepack (npm/pnpm/yarn) (~65 MB download, ~89 MB final). Data persists in `/data` volume (`/data/workspace` for project files, `/data/home` symlinked to `/root` for configs).

## Programmatic

```ts
import { startCodeServer } from "coderaft";

const instance = await startCodeServer({
  port: 6063,
  host: "127.0.0.1",
  defaultFolder: "/path/to/workspace",
  // connectionToken: "my-secret", // disabled for localhost, auto-generated otherwise
});

console.log(`Ready at ${instance.url}`);

// Later:
await instance.close();
```

### Middleware

Use `createCodeServer` to get a request handler without starting a listener. This lets you integrate code-server into any existing Node.js HTTP server or framework:

```ts
import { createServer } from "node:http";
import { createCodeServer } from "coderaft";

const handler = await createCodeServer({
  defaultFolder: "/path/to/workspace",
});

const server = createServer((req, res) => {
  handler.handleRequest(req, res);
});

server.on("upgrade", (req, socket) => {
  handler.handleUpgrade(req, socket);
});

server.listen(3000);
```

### `createCodeServer(options)`

Creates a code-server handler without binding to a port.

| Option            | Type                  | Description                                                                  |
| ----------------- | --------------------- | ---------------------------------------------------------------------------- |
| `defaultFolder`   | `string`              | Workspace folder opened when no input is given in the URL.                   |
| `connectionToken` | `string`              | Shared auth secret. Disabled for localhost, auto-generated for remote hosts. |
| `host`            | `string`              | Host/interface to bind. Used to infer whether to require a token.            |
| `baseURL`         | `string`              | Base URL the server is mounted under (e.g. `/code`). Defaults to `/`.        |
| `proxyURI`        | `string`              | Proxy URI template for forwarded ports (see [Port Proxy](#port-proxy)).      |
| `extensions`      | `string[]`            | Extensions to preinstall before start (see [Extensions](#extensions)).       |
| `vscode`          | `VSCodeServerOptions` | Extra options forwarded to VS Code's internal `createServer()`.              |

Returns a `CodeServerHandler`:

```ts
interface CodeServerHandler {
  handleRequest(req: IncomingMessage, res: ServerResponse): void;
  handleUpgrade(req: IncomingMessage, socket: Duplex): void;
  connectionToken: string;
  dispose(): Promise<void>;
}
```

### `startCodeServer(options)`

Convenience wrapper around `createCodeServer` that creates an HTTP server and starts listening.

Accepts all `createCodeServer` options plus:

| Option | Type     | Description                                           |
| ------ | -------- | ----------------------------------------------------- |
| `port` | `number` | TCP port to listen on. Defaults to `$PORT` or `6063`. |

Returns a `CodeServerHandle`:

```ts
interface CodeServerHandle {
  server: http.Server;
  port: number;
  url: string;
  connectionToken: string;
  close(): Promise<void>;
}
```

### `spawnCodeServer(options)`

Runs the code-server in a forked Node.js child process — useful for isolating VS Code's singletons from the host or restarting the server without taking the host down. Accepts the same options as `startCodeServer`, plus a `spawn` sub-object (`env`, `execArgv`, `stdio`, `startupTimeout`).

```ts
import { spawnCodeServer } from "coderaft";

const instance = await spawnCodeServer({
  port: 6063,
  defaultFolder: "/path/to/workspace",
});

console.log(`Ready at ${instance.url}`);

// Notify on unexpected worker exits (not fired during close/reload):
instance.on("exit", (code, signal) => {
  console.warn(`worker died code=${code} signal=${signal}`);
});

// Restart the worker in place (reads fresh url/port/connectionToken after):
await instance.reload();

// Graceful shutdown — SIGTERM to the worker, then SIGKILL after 5s:
await instance.close();
```

Options cross an IPC boundary, so nested values (`vscode`, etc.) must be JSON-compatible.

## Extensions

Preinstall extensions when an instance starts by passing an `extensions` array. Ids resolve from the [Open VSX](https://open-vsx.org) registry by default — the same gallery the in-editor Extensions view uses.

```ts
import { startCodeServer } from "coderaft";

const instance = await startCodeServer({
  defaultFolder: "/path/to/workspace",
  extensions: [
    "esbenp.prettier-vscode", // gallery id
    "dbaeumer.vscode-eslint@3.0.24", // pin a version
    "/abs/path/to/local.vsix", // local .vsix file
  ],
});
```

Works with `createCodeServer`, `startCodeServer`, and `spawnCodeServer`, and on the CLI:

```sh
coderaft --preinstall-extension esbenp.prettier-vscode --preinstall-extension dbaeumer.vscode-eslint
```

- **Idempotent** — already-installed extensions are skipped, so warm restarts pay no cost. Installs run only when something is missing.
- **Non-blocking on failure** — a bad id or a gallery outage is logged as a warning; the server still starts.
- Installs into the server's extensions dir (`--extensions-dir`, default `~/.vscode-server-oss/extensions`), so they persist across restarts.

> [!NOTE]
> Installation runs in a short-lived child process before the server boots (VS Code's extension CLI calls `process.exit()` when done). The first cold start with new extensions takes ~1s longer per extension; subsequent starts are instant.

### Managing extensions without starting a server

`--install-extension`, `--uninstall-extension`, and `--list-extensions` behave like the `code` CLI: they act on the extensions dir, print the result, and exit. That is what tooling which shells out to `code --install-extension <id>` (IDE extension installers, provisioning scripts) expects, so coderaft can stand in for `code` on the `PATH`.

```sh
coderaft --install-extension esbenp.prettier-vscode   # add --force to reinstall
coderaft --list-extensions --show-versions
coderaft --uninstall-extension esbenp.prettier-vscode
```

The exit code reflects the outcome — a spec that failed to install exits non-zero. Use `--preinstall-extension` when you want to install _and then_ serve.

## CLI Options

### Server

| Option                        | Description                                                            |
| ----------------------------- | ---------------------------------------------------------------------- |
| `-p, --port <port>`           | Port to listen on (default: `$PORT` or `6063`)                         |
| `-H, --host <host>`           | Host/interface to bind                                                 |
| `--base-url <path>`           | Base URL the server is mounted under (default: `/`)                    |
| `--proxy-uri <template>`      | Proxy URI template for forwarded ports (see [Port Proxy](#port-proxy)) |
| `--socket-path <path>`        | Path to a socket file to listen on                                     |
| `--print-startup-performance` | Print startup timing to stdout                                         |

### Auth

> [!NOTE]
> When binding to `localhost` / `127.0.0.1` (or no `--host`), the connection token is **disabled by default** for convenience. When binding to any other host, a token is auto-generated unless `--without-connection-token` is explicitly passed. You can always override by providing `--token` or `--connection-token`.

| Option                           | Description                                           |
| -------------------------------- | ----------------------------------------------------- |
| `-t, --token <token>`            | Connection token for auth (shorthand)                 |
| `--connection-token <token>`     | Connection token for auth (auto-generated if omitted) |
| `--connection-token-file <path>` | Path to file containing the connection token          |
| `--without-connection-token`     | Disable connection token auth                         |
| `--auth <type>`                  | Auth type                                             |
| `--github-auth <token>`          | GitHub auth token                                     |

### Defaults

| Option                       | Description                      |
| ---------------------------- | -------------------------------- |
| `--default-folder <path>`    | Default workspace folder         |
| `--default-workspace <path>` | Default workspace file           |
| `--locale <locale>`          | The locale to use (e.g. `en-US`) |

### Data Directories

| Option                             | Description                   |
| ---------------------------------- | ----------------------------- |
| `--server-data-dir <path>`         | Server data directory         |
| `--user-data-dir <path>`           | User data directory           |
| `--extensions-dir <path>`          | Extensions directory          |
| `--extensions-download-dir <path>` | Extensions download directory |
| `--builtin-extensions-dir <path>`  | Built-in extensions directory |
| `--agent-plugins-dir <path>`       | Agent plugins directory       |

### Logging

| Option               | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `--log <level>`      | Log level (`off`, `critical`, `error`, `warn`, `info`, `debug`, `trace`) |
| `--logs-path <path>` | Logs output directory                                                    |

### Network

| Option                            | Description                   |
| --------------------------------- | ----------------------------- |
| `--disable-websocket-compression` | Disable WebSocket compression |
| `--use-host-proxy`                | Enable host proxy             |

### Files

| Option                        | Description                   |
| ----------------------------- | ----------------------------- |
| `--disable-file-downloads`    | Disable file downloads        |
| `--disable-file-uploads`      | Disable file uploads          |
| `--file-watcher-polling <ms>` | File watcher polling interval |

### Telemetry

| Option                      | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `--telemetry-level <level>` | Telemetry level (`off`, `crash`, `error`, `all`) |
| `--disable-telemetry`       | Disable telemetry                                |
| `--disable-update-check`    | Disable update check                             |
| `--disable-experiments`     | Disable experiments                              |

### Extension Management

These run against the extensions dir and exit without starting a server (see [Extensions](#extensions)).

| Option                           | Description                                           |
| -------------------------------- | ----------------------------------------------------- |
| `--install-extension <ext-id>`   | Install an extension from Open VSX (repeatable)       |
| `--uninstall-extension <ext-id>` | Uninstall an extension (repeatable)                   |
| `--list-extensions`              | List installed extensions                             |
| `--show-versions`                | Show versions in `--list-extensions` output           |
| `--force`                        | Reinstall even if the extension is already installed  |
| `--pre-release`                  | Install the pre-release version when one is available |

### Features

| Option                               | Description                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `--enable-sync`                      | Enable settings sync                                                                        |
| `--preinstall-extension <ext-id>`    | Install an extension before starting the server (repeatable, see [Extensions](#extensions)) |
| `--enable-proposed-api <ext-id>`     | Enable proposed API for an extension (repeatable)                                           |
| `--disable-workspace-trust`          | Disable workspace trust                                                                     |
| `--disable-getting-started-override` | Disable getting started override                                                            |

### Remote

| Option                                 | Description                                           |
| -------------------------------------- | ----------------------------------------------------- |
| `--enable-remote-auto-shutdown`        | Enable remote auto shutdown                           |
| `--remote-auto-shutdown-without-delay` | Auto shutdown without delay                           |
| `--without-browser-env-var`            | Disable browser env var                               |
| `--reconnection-grace-time <sec>`      | Reconnection grace time in seconds (default: `10800`) |

### Agent Host

| Option                     | Description                      |
| -------------------------- | -------------------------------- |
| `--agent-host-path <path>` | Agent host WebSocket socket path |
| `--agent-host-port <port>` | Agent host WebSocket port        |

### Shell

| Option                     | Description                             |
| -------------------------- | --------------------------------------- |
| `--force-disable-user-env` | Force disable user shell env resolution |
| `--force-user-env`         | Force user shell env resolution         |

### Other

| Option       | Description                                            |
| ------------ | ------------------------------------------------------ |
| `--no-fork`  | Run server in the main process (no subprocess)         |
| `--no-tui`   | Disable interactive terminal UI (alt screen with logs) |
| `-o, --open` | Open in browser on startup                             |

### Debugging

| Option                             | Description                         |
| ---------------------------------- | ----------------------------------- |
| `--inspect-ptyhost <port>`         | Inspect pty host                    |
| `--inspect-brk-ptyhost <port>`     | Inspect pty host (break on start)   |
| `--inspect-agenthost <port>`       | Inspect agent host                  |
| `--inspect-brk-agenthost <port>`   | Inspect agent host (break on start) |
| `--enable-smoke-test-driver`       | Enable smoke test driver            |
| `--crash-reporter-directory <dir>` | Crash reporter directory            |
| `--crash-reporter-id <id>`         | Crash reporter ID                   |

## Port Proxy

When a VS Code extension or the terminal opens a local URL (e.g. `http://localhost:3000`), coderaft proxies it through the browser. By default, ports are proxied via a path-based scheme:

```
https://example.com/proxy/3000/
```

When using `--base-url`, the base path is automatically prepended:

```sh
coderaft --base-url /code
# → https://example.com/code/proxy/3000/
```

For subdomain-based proxying, use `--proxy-uri` with a `{{port}}` placeholder:

```sh
coderaft --proxy-uri "https://{{port}}.proxy.example.com/"
# → https://3000.proxy.example.com/
```

Subdomain proxying requires external infrastructure (wildcard DNS + reverse proxy) — coderaft's built-in proxy handler only supports path-based routing.

The `VSCODE_PROXY_URI` environment variable can also be used and takes the same template format.

## Sponsors

<p align="center">
  <a href="https://sponsors.pi0.io/">
    <img src="https://sponsors.pi0.io/sponsors.svg?xyz">
  </a>
</p>

## License

MIT, with bundled third-party packages. See [lib/LICENSE.md](./lib/LICENSE.md).
