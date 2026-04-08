# 🛶 coderaft

[![npm version](https://img.shields.io/npm/v/coderaft?color=blue)](https://npmx.dev/package/coderaft)
[![install size](https://packagephobia.com/badge?p=coderaft)](https://packagephobia.com/result?p=coderaft)

Run VS Code on any machine anywhere and access it in the browser.

A redistribution of [coder/code-server](https://github.com/coder/code-server) bundled into a single zero-dependency package (**~32 MB** vs 776 MB — **~25x smaller**). Native modules are shimmed with better alternatives ([zigpty](https://github.com/pithings/zigpty), [ripgrep-node](https://github.com/pithings/ripgrep-node), [...more](./shims/README.md)).

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

## CLI Usage

Start a an instance:

```sh
npx coderaft -o .
```

## Programmatic Usage

```ts
import { startCodeServer } from "coderaft";

const instance = await startCodeServer({
  port: 8080,
  host: "127.0.0.1",
  defaultFolder: "/path/to/workspace",
  // connectionToken: "my-secret", // auto-generated if omitted
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

| Option            | Type                  | Description                                                     |
| ----------------- | --------------------- | --------------------------------------------------------------- |
| `defaultFolder`   | `string`              | Workspace folder opened when no input is given in the URL.      |
| `connectionToken` | `string`              | Shared auth secret. Auto-generated if omitted.                  |
| `vscode`          | `VSCodeServerOptions` | Extra options forwarded to VS Code's internal `createServer()`. |

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

| Option | Type     | Description                                                          |
| ------ | -------- | -------------------------------------------------------------------- |
| `port` | `number` | TCP port to listen on. Defaults to `$PORT` or `8080`.                |
| `host` | `string` | Host/interface to bind. Defaults to Node's default (all interfaces). |

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

## CLI Options

### Server

| Option                        | Description                                    |
| ----------------------------- | ---------------------------------------------- |
| `-p, --port <port>`           | Port to listen on (default: `$PORT` or `8080`) |
| `-H, --host <host>`           | Host/interface to bind                         |
| `--server-base-path <path>`   | Base path for the web UI (default: `/`)        |
| `--socket-path <path>`        | Path to a socket file to listen on             |
| `--print-startup-performance` | Print startup timing to stdout                 |

### Auth

| Option                           | Description                                           |
| -------------------------------- | ----------------------------------------------------- |
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

### Features

| Option                               | Description                                       |
| ------------------------------------ | ------------------------------------------------- |
| `--enable-sync`                      | Enable settings sync                              |
| `--enable-proposed-api <ext-id>`     | Enable proposed API for an extension (repeatable) |
| `--disable-workspace-trust`          | Disable workspace trust                           |
| `--disable-getting-started-override` | Disable getting started override                  |

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

## License

MIT, with bundled third-party packages. See [lib/LICENSE.md](./lib/LICENSE.md).
