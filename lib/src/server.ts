import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { serveStatic } from "./static.ts";
import type { VSCodeServerOptions } from "./types.ts";
import { loadCode } from "#code";

// PWA manifest — matches the shape coder/code-server generates (with maskable
// icon variants + `display_override`).
const MANIFEST_BODY = JSON.stringify({
  name: "code-server",
  short_name: "code-server",
  start_url: ".",
  display: "fullscreen",
  display_override: ["window-controls-overlay"],
  description: "Run Code on a remote server.",
  icons: [192, 512].flatMap((size) => [
    {
      src: `./_static/src/browser/media/pwa-icon-${size}.png`,
      type: "image/png",
      sizes: `${size}x${size}`,
      purpose: "any",
    },
    {
      src: `./_static/src/browser/media/pwa-icon-maskable-${size}.png`,
      type: "image/png",
      sizes: `${size}x${size}`,
      purpose: "maskable",
    },
  ]),
});

const ROBOTS_TXT = "User-agent: *\nDisallow: /\n";

export interface CreateCodeServerOptions {
  /** Workspace folder opened when no input is given in the URL. */
  defaultFolder?: string;
  /** Connection token (shared auth secret). Auto-generated if omitted. */
  connectionToken?: string;
  /** Extra options forwarded to VS Code's `createServer()`. */
  vscode?: VSCodeServerOptions;
}

export interface StartCodeServerOptions extends CreateCodeServerOptions {
  /** TCP port to listen on. Defaults to `$PORT` or `8080`. */
  port?: number;
  /** Host/interface to bind. Defaults to Node's default (all interfaces). */
  host?: string;
}

export interface CodeServerHandler {
  /** Node-style HTTP request handler (middleware). */
  handleRequest(req: IncomingMessage, res: ServerResponse): void;
  /** Handle WebSocket upgrade. */
  handleUpgrade(req: IncomingMessage, socket: Duplex): void;
  connectionToken: string;
  dispose(): Promise<void>;
}

export interface CodeServerHandle {
  server: Server;
  port: number;
  url: string;
  connectionToken: string;
  close(): Promise<void>;
}

export async function createCodeServer(
  opts: CreateCodeServerOptions = {},
): Promise<CodeServerHandler> {
  const withoutToken = opts.vscode?.["without-connection-token"] === true;
  const connectionToken = withoutToken ? "" : (opts.connectionToken ?? randomUUID());
  const defaultFolder = opts.defaultFolder ?? process.cwd();

  // Stable per-process 32-byte key returned by POST /mint-key. VS Code's
  // `serve-web` flow uses this as one half of a symmetric auth secret. Coder
  // persists it to disk; for our mock a fresh key per boot is fine.
  const mintKey = randomBytes(32);

  // Suppress server-main.js's implicit standalone auto-boot. The module's
  // top-level is `process.env.CODE_SERVER_PARENT_PID || YH()`, where `YH` spins
  // up its own http.Server on `--port`/`$VSCODE_SERVER_PORT`/8000 and logs
  // `Web UI available at http://localhost:8000?tkn=…`. Setting this env var
  // makes the import a no-op side-effect-wise so our manual `createServer(null,
  // …)` call below is the only server.
  process.env.CODE_SERVER_PARENT_PID ??= String(process.pid);

  const userDataDir =
    opts.vscode?.["user-data-dir"] ?? join(homedir(), ".vscode-server-oss", "data");

  // Remove stale workspace storage lock files left behind by ungraceful exits
  cleanupStaleLocks(userDataDir);

  const { modulesDir } = await loadCode();
  const vsRootPath = join(modulesDir, "code-server", "lib", "vscode");

  // Load VS Code server module
  const mod = await import(join(vsRootPath, "out/server-main.js"));
  const serverModule = await mod.loadCodeWithNls();
  const vscodeServer = await serverModule.createServer(null, {
    "default-folder": defaultFolder,
    ...(withoutToken ? {} : { "connection-token": connectionToken }),
    // Suppress coder/code-server's custom "Getting Started" walkthrough
    // (the promo page linking to cdr.co). Gated by the
    // `isEnabledCoderGettingStarted` context key in the workbench; defaults
    // to on unless this flag is passed.
    "disable-getting-started-override": true,
    ...opts.vscode,
  } satisfies VSCodeServerOptions);

  return {
    connectionToken,
    handleRequest(req: IncomingMessage, res: ServerResponse) {
      const method = req.method ?? "GET";
      const url = (req.url ?? "/").split("?")[0]!;

      // PWA manifest — referenced by workbench.html `<link rel="manifest">`.
      if (url === "/manifest.json") {
        res.writeHead(200, {
          "Content-Type": "application/manifest+json",
          "Cache-Control": "no-cache",
        });
        res.end(MANIFEST_BODY);
        return;
      }

      // Health probe — shape matches coder/code-server's `/healthz` route so load
      // balancers / orchestrators that expect it keep working.
      if (url === "/healthz") {
        sendJson(res, 200, { status: "alive", lastHeartbeat: Date.now() });
        return;
      }

      // Update checker stub — always report "up to date". VS Code's workbench
      // calls this via the `updateEndpoint` baked into its product config. Shape
      // matches coder's `UpdateProvider.getUpdate` response.
      if (url === "/update/check") {
        const codeServerVersion = (
          JSON.parse(readFileSync(join(modulesDir, "code-server", "package.json"), "utf8")) as {
            version: string;
          }
        ).version;

        sendJson(res, 200, {
          checked: Date.now(),
          latest: codeServerVersion,
          current: codeServerVersion,
          isLatest: true,
        });
        return;
      }

      if (url === "/robots.txt") {
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Length": Buffer.byteLength(ROBOTS_TXT),
        });
        res.end(ROBOTS_TXT);
        return;
      }

      // `POST /mint-key` — VS Code `serve-web` auth handshake. Return a stable
      // 32-byte key; coder persists this, we keep it in-memory per boot.
      if (url === "/mint-key" && method === "POST") {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": mintKey.length,
        });
        res.end(mintKey);
        return;
      }

      // `/login` + `/logout` — we never enable auth, so mirror coder's no-auth
      // behavior (redirect to root).
      if (url === "/login" || url === "/logout") {
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }

      // `/_static/*` is coder/code-server's prefix for assets under the
      // `code-server` npm package root (PWA icons, service worker, etc.).
      // Upstream vscode's own `/static/*` is handled separately by handleRequest.
      if (url.startsWith("/_static/")) {
        serveStatic(res, join(modulesDir, "code-server"), url.slice("/_static/".length)).then(
          (served) => {
            if (!served) {
              vscodeServer.handleRequest(req, res);
            }
          },
        );
        return;
      }

      vscodeServer.handleRequest(req, res);
    },
    handleUpgrade(req: IncomingMessage, socket: Duplex) {
      vscodeServer.handleUpgrade(req, socket);
      socket.resume();
    },
    async dispose() {
      vscodeServer.dispose();
    },
  };
}

export async function startCodeServer(
  opts: StartCodeServerOptions = {},
): Promise<CodeServerHandle> {
  const port = opts.port ?? (Number(process.env.PORT) || 8080);
  const handler = await createCodeServer(opts);

  const server = createServer((req, res) => {
    handler.handleRequest(req, res);
  });

  server.on("upgrade", (req, socket) => {
    handler.handleUpgrade(req, socket);
  });

  await new Promise<void>((resolve) => {
    if (opts.host) {
      server.listen(port, opts.host, resolve);
    } else {
      server.listen(port, resolve);
    }
  });

  const actualPort = (server.address() as { port: number }).port;

  const url = handler.connectionToken
    ? `http://localhost:${actualPort}/?tkn=${handler.connectionToken}`
    : `http://localhost:${actualPort}/`;

  return {
    server,
    port: actualPort,
    url,
    connectionToken: handler.connectionToken,
    async close() {
      await handler.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

function cleanupStaleLocks(userDataDir: string): void {
  const storageDir = join(userDataDir, "User", "workspaceStorage");
  try {
    for (const entry of readdirSync(storageDir)) {
      const lockPath = join(storageDir, entry, "vscode.lock");
      try {
        unlinkSync(lockPath);
      } catch {
        // Lock file doesn't exist — nothing to clean
      }
    }
  } catch {
    // Storage directory doesn't exist yet — first run
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
