# code-server-slim

Run VS Code on any machine anywhere and access it in the browser.

This package is a redistribution of [coder/code-server](https://github.com/coder/code-server) with improvements for portability. Native dependencies are shimmed out or replaced with pure-JS / prebuilt alternatives, keeping the install lean and self-contained.

See [shims/README.md](./shims/README.md) for the full list of replaced dependencies and rationale.

## CLI Usage

Start a server on the default port (`$PORT` or `8080`):

```sh
npx code-server-slim
```

Once ready, the CLI prints a URL with a generated connection token:

```
  ➜  Ready at http://localhost:8080/?tkn=<token>
```

### CLI Options

#### Server

| Option                        | Description                                    |
| ----------------------------- | ---------------------------------------------- |
| `-p, --port <port>`           | Port to listen on (default: `$PORT` or `8080`) |
| `-H, --host <host>`           | Host/interface to bind                         |
| `--server-base-path <path>`   | Base path for the web UI (default: `/`)        |
| `--socket-path <path>`        | Path to a socket file to listen on             |
| `--print-startup-performance` | Print startup timing to stdout                 |

#### Auth

| Option                           | Description                                           |
| -------------------------------- | ----------------------------------------------------- |
| `--connection-token <token>`     | Connection token for auth (auto-generated if omitted) |
| `--connection-token-file <path>` | Path to file containing the connection token          |
| `--without-connection-token`     | Disable connection token auth                         |
| `--auth <type>`                  | Auth type                                             |
| `--github-auth <token>`          | GitHub auth token                                     |

#### Defaults

| Option                       | Description                      |
| ---------------------------- | -------------------------------- |
| `--default-folder <path>`    | Default workspace folder         |
| `--default-workspace <path>` | Default workspace file           |
| `--locale <locale>`          | The locale to use (e.g. `en-US`) |

#### Data Directories

| Option                             | Description                   |
| ---------------------------------- | ----------------------------- |
| `--server-data-dir <path>`         | Server data directory         |
| `--user-data-dir <path>`           | User data directory           |
| `--extensions-dir <path>`          | Extensions directory          |
| `--extensions-download-dir <path>` | Extensions download directory |
| `--builtin-extensions-dir <path>`  | Built-in extensions directory |
| `--agent-plugins-dir <path>`       | Agent plugins directory       |

#### Logging

| Option               | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `--log <level>`      | Log level (`off`, `critical`, `error`, `warn`, `info`, `debug`, `trace`) |
| `--logs-path <path>` | Logs output directory                                                    |

#### Network

| Option                            | Description                   |
| --------------------------------- | ----------------------------- |
| `--disable-websocket-compression` | Disable WebSocket compression |
| `--use-host-proxy`                | Enable host proxy             |

#### Files

| Option                        | Description                   |
| ----------------------------- | ----------------------------- |
| `--disable-file-downloads`    | Disable file downloads        |
| `--disable-file-uploads`      | Disable file uploads          |
| `--file-watcher-polling <ms>` | File watcher polling interval |

#### Telemetry

| Option                      | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `--telemetry-level <level>` | Telemetry level (`off`, `crash`, `error`, `all`) |
| `--disable-telemetry`       | Disable telemetry                                |
| `--disable-update-check`    | Disable update check                             |
| `--disable-experiments`     | Disable experiments                              |

#### Features

| Option                               | Description                                       |
| ------------------------------------ | ------------------------------------------------- |
| `--enable-sync`                      | Enable settings sync                              |
| `--enable-proposed-api <ext-id>`     | Enable proposed API for an extension (repeatable) |
| `--disable-workspace-trust`          | Disable workspace trust                           |
| `--disable-getting-started-override` | Disable getting started override                  |

#### Remote

| Option                                 | Description                                           |
| -------------------------------------- | ----------------------------------------------------- |
| `--enable-remote-auto-shutdown`        | Enable remote auto shutdown                           |
| `--remote-auto-shutdown-without-delay` | Auto shutdown without delay                           |
| `--without-browser-env-var`            | Disable browser env var                               |
| `--reconnection-grace-time <sec>`      | Reconnection grace time in seconds (default: `10800`) |

#### Agent Host

| Option                     | Description                      |
| -------------------------- | -------------------------------- |
| `--agent-host-path <path>` | Agent host WebSocket socket path |
| `--agent-host-port <port>` | Agent host WebSocket port        |

#### Shell

| Option                     | Description                             |
| -------------------------- | --------------------------------------- |
| `--force-disable-user-env` | Force disable user shell env resolution |
| `--force-user-env`         | Force user shell env resolution         |

#### Debugging

| Option                             | Description                         |
| ---------------------------------- | ----------------------------------- |
| `--inspect-ptyhost <port>`         | Inspect pty host                    |
| `--inspect-brk-ptyhost <port>`     | Inspect pty host (break on start)   |
| `--inspect-agenthost <port>`       | Inspect agent host                  |
| `--inspect-brk-agenthost <port>`   | Inspect agent host (break on start) |
| `--enable-smoke-test-driver`       | Enable smoke test driver            |
| `--crash-reporter-directory <dir>` | Crash reporter directory            |
| `--crash-reporter-id <id>`         | Crash reporter ID                   |

## Programmatic Usage

### Quick Start

```ts
import { startCodeServer } from "code-server-slim";

const handle = await startCodeServer({
  port: 8080,
  host: "127.0.0.1",
  defaultFolder: "/path/to/workspace",
  // connectionToken: "my-secret", // auto-generated if omitted
});

console.log(`Ready at ${handle.url}`);

// Later:
await handle.close();
```

### Middleware Usage

Use `createCodeServer` to get a request handler without starting a listener. This lets you integrate code-server into any existing Node.js HTTP server or framework:

```ts
import { createServer } from "node:http";
import { createCodeServer } from "code-server-slim";

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

## License

MIT, with bundled third-party packages. See [lib/LICENSE.md](./lib/LICENSE.md).
