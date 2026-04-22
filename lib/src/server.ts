import "./_android.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { pathToFileURL } from "node:url";
import { createProxyServer } from "httpxy";
import { serveStatic } from "./static.ts";
import type { VSCodeServerOptions } from "./types.ts";
import { loadCode } from "#code";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _os: typeof import("node:os") = process.getBuiltinModule?.("os") ?? require("node:os");

// PWA manifest — matches the shape coder/code-server generates (with maskable
// icon variants + `display_override`).
const MANIFEST_BODY = JSON.stringify({
  name: "coderaft",
  short_name: "coderaft",
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
  /** File to open on startup. Absolute path. */
  openFile?: string;
  /** Connection token (shared auth secret). Auto-generated if omitted. */
  connectionToken?: string;
  /** Host/interface to bind (used to infer local-only access for token default). */
  host?: string;
  /**
   * Base URL the server is mounted under (e.g. `/code`). Defaults to `/`.
   * Forwarded to VS Code as `server-base-path` and honored by coderaft's own
   * routes (`/healthz`, `/_static/*`, `/proxy/*`, `/login`, …).
   */
  baseURL?: string;
  /** Extra options forwarded to VS Code's `createServer()`. */
  vscode?: VSCodeServerOptions;
}

export interface StartCodeServerOptions extends CreateCodeServerOptions {
  /** TCP port to listen on. Defaults to `$PORT` or `6063`. Ignored when `socketPath` is set. */
  port?: number;
  /** Unix socket path to listen on. When set, `port` and `host` are ignored. */
  socketPath?: string;
}

export interface CodeServerHandler {
  /** Node-style HTTP request handler (middleware). */
  handleRequest(req: IncomingMessage, res: ServerResponse): void;
  /** Handle WebSocket upgrade. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  connectionToken: string;
  dispose(): Promise<void>;
}

export interface CodeServerHandle {
  server: Server;
  /** TCP port the server is bound to, or `undefined` when listening on a unix socket. */
  port?: number;
  /** Unix socket path the server is bound to, or `undefined` when listening on TCP. */
  socketPath?: string;
  url: string;
  connectionToken: string;
  close(): Promise<void>;
}

export async function createCodeServer(
  opts: CreateCodeServerOptions = {},
): Promise<CodeServerHandler> {
  // Default to no connection token for local access (localhost/127.0.0.1 or no
  // host specified). When an explicit host is given that isn't local, require a
  // token unless `--without-connection-token` is explicitly passed.
  const explicitToken = opts.connectionToken || opts.vscode?.["connection-token"];
  const isLocal = !opts.host || /^(localhost|127\.0\.0\.1)$/.test(opts.host);
  const withoutToken =
    opts.vscode?.["without-connection-token"] === true || (!explicitToken && isLocal);
  const connectionToken = withoutToken ? "" : (opts.connectionToken ?? randomUUID());
  const defaultFolder = opts.defaultFolder ?? process.cwd();
  const baseURL = normalizeBaseURL(opts.baseURL ?? opts.vscode?.["server-base-path"]);

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
    opts.vscode?.["user-data-dir"] ?? join(_os.homedir(), ".vscode-server-oss", "data");

  // Remove stale workspace storage lock files left behind by ungraceful exits
  cleanupStaleLocks(userDataDir);

  watchChildProcessHealth();

  const { modulesDir } = await loadCode();
  const vsRootPath = join(modulesDir, "code-server", "lib", "vscode");

  // Load VS Code server module — mute noisy internal logs during init
  const _log = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("[reconnection-grace-time]")) return;
    // Suppress VS Code's empty startup banner (timestamp + newlines)
    if (args.length === 2 && typeof args[1] === "string" && !args[1].trim()) return;
    _log(...args);
  };
  const mod = await import(pathToFileURL(join(vsRootPath, "out/server-main.js")).href);
  // Override product branding from upstream "code-server" to "coderaft"
  const _product = (globalThis as Record<string, unknown>)._VSCODE_PRODUCT_JSON as
    | Record<string, unknown>
    | undefined;
  if (_product) {
    _product.nameShort = "coderaft";
    _product.nameLong = "coderaft";
    _product.applicationName = "coderaft";
  }
  const serverModule = await mod.loadCodeWithNls();
  const vscodeServer = await serverModule.createServer(null, {
    "default-folder": defaultFolder,
    ...(baseURL ? { "server-base-path": baseURL } : {}),
    ...(withoutToken
      ? { "without-connection-token": true }
      : { "connection-token": connectionToken }),
    // Grace time for reconnecting after a disconnect. Keep it short so that
    // stale extension hosts (and their workspace locks) are cleaned up quickly
    // when a browser tab is hard-refreshed (new connection ID).
    "reconnection-grace-time": "30",
    // Suppress coder/code-server's custom "Getting Started" walkthrough
    // (the promo page linking to cdr.co). Gated by the
    // `isEnabledCoderGettingStarted` context key in the workbench; defaults
    // to on unless this flag is passed.
    "disable-getting-started-override": true,
    ...opts.vscode,
  } satisfies VSCodeServerOptions);
  console.log = _log;

  const proxy = createProxyServer({});
  proxy.on("error", (err, req, res) => {
    if (res && "writeHead" in res) {
      (res as ServerResponse).writeHead(502, { "Content-Type": "text/plain" });
      (res as ServerResponse).end(`Proxy error: ${err.message}`);
    }
  });

  return {
    connectionToken,
    handleRequest(req: IncomingMessage, res: ServerResponse) {
      const method = req.method ?? "GET";
      const strippedUrl = stripBaseURL(req.url ?? "/", baseURL);
      const url = strippedUrl.split("?")[0]!;

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
        res.writeHead(302, { Location: `${baseURL}/` });
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

      // Path-based proxy: /proxy/:port/* → http://127.0.0.1:{port}/*
      const proxyMatch = parseProxyPath(strippedUrl);
      if (proxyMatch) {
        const { port: targetPort, path: targetPath } = proxyMatch;
        proxy.web(req, res, {
          target: `http://127.0.0.1:${targetPort}${targetPath}`,
          ignorePath: true,
          xfwd: true,
        });
        return;
      }

      vscodeServer.handleRequest(req, res);
    },
    handleUpgrade(req: IncomingMessage, socket: Duplex, _head: Buffer) {
      // Path-based proxy: WebSocket upgrade
      const proxyMatch = parseProxyPath(stripBaseURL(req.url ?? "/", baseURL));
      if (proxyMatch) {
        const { port: targetPort, path: targetPath } = proxyMatch;
        proxy.ws(
          req,
          socket as import("node:net").Socket,
          {
            target: `http://127.0.0.1:${targetPort}${targetPath}`,
            ignorePath: true,
            xfwd: true,
          },
          _head,
        );
        return;
      }

      vscodeServer.handleUpgrade(req, socket, _head);
    },
    async dispose() {
      vscodeServer.dispose();
    },
  };
}

export async function startCodeServer(
  opts: StartCodeServerOptions = {},
): Promise<CodeServerHandle> {
  const socketPath = opts.socketPath;
  const port = opts.port ?? (Number(process.env.PORT) || 6063);
  const handler = await createCodeServer(opts);

  const server = createServer((req, res) => {
    handler.handleRequest(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    handler.handleUpgrade(req, socket, head);
  });

  const listenTcp = (p: number) =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      const cb = () => {
        server.removeListener("error", reject);
        resolve();
      };
      if (opts.host) {
        server.listen(p, opts.host, cb);
      } else {
        server.listen(p, cb);
      }
    });

  const listenSocket = (path: string) =>
    new Promise<void>((resolve, reject) => {
      // Remove a stale socket file left behind by a previous ungraceful exit.
      try {
        unlinkSync(path);
      } catch {
        // File doesn't exist — nothing to clean up.
      }
      server.once("error", reject);
      server.listen(path, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

  if (socketPath) {
    await listenSocket(socketPath);
  } else {
    try {
      await listenTcp(port);
    } catch (err: any) {
      if (err?.code === "EADDRINUSE") {
        await listenTcp(0);
      } else {
        throw err;
      }
    }
  }

  const address = server.address();
  const actualPort =
    address && typeof address === "object" && "port" in address ? address.port : undefined;

  const basePath = normalizeBaseURL(opts.baseURL ?? opts.vscode?.["server-base-path"]);
  let url: string;
  if (socketPath) {
    url = `unix:${socketPath}`;
  } else {
    const baseUrl = new URL(`http://localhost:${actualPort}${basePath}/`);
    if (handler.connectionToken) baseUrl.searchParams.set("tkn", handler.connectionToken);
    if (opts.openFile) {
      baseUrl.searchParams.set(
        "payload",
        JSON.stringify([["openFile", `vscode-remote://remote${opts.openFile}`]]),
      );
    }
    url = baseUrl.toString();
  }

  return {
    server,
    port: actualPort,
    socketPath,
    url,
    connectionToken: handler.connectionToken,
    async close() {
      await handler.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      if (socketPath) {
        try {
          unlinkSync(socketPath);
        } catch {
          // Socket already removed.
        }
      }
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
        console.log(`[coderaft] Removed stale lock: ${lockPath}`);
      } catch {
        // Lock file doesn't exist — nothing to clean
      }
    }
  } catch {
    // Storage directory doesn't exist yet — first run
  }
}

// Watches child processes for main-thread deadlocks by reading /proc/<pid>/wchan.
// Only works on Linux.
function watchChildProcessHealth(): NodeJS.Timeout | undefined {
  if (process.platform !== "linux" && process.platform !== "android") return;
  const stuckCounts = new Map<number, number>();
  const interval = setInterval(() => {
    try {
      for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
        let cmdline: string;
        try {
          cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
        } catch {
          continue;
        }
        if (!cmdline.includes("extensionHost")) continue;
        try {
          const wchan = readFileSync(`/proc/${pid}/task/${pid}/wchan`, "utf8").trim();
          if (wchan === "__futex_wait") {
            const count = (stuckCounts.get(+pid) ?? 0) + 1;
            stuckCounts.set(+pid, count);
            if (count === 3) {
              console.error(
                `[coderaft] Extension host (pid ${pid}) main thread stuck in ${wchan} for ${count * 5}s`,
              );
            }
          } else {
            stuckCounts.delete(+pid);
          }
        } catch {}
      }
    } catch {}
  }, 5000);
  interval.unref();
  return interval;
}

// Matches /proxy/:port or /proxy/:port/rest/of/path?query
// Returns { port, path } where path includes the query string.
const PROXY_RE = /^\/proxy\/(\d+)(\/.*)?$/;

function parseProxyPath(url: string): { port: number; path: string } | undefined {
  const qIdx = url.indexOf("?");
  const pathname = qIdx === -1 ? url : url.slice(0, qIdx);
  const query = qIdx === -1 ? "" : url.slice(qIdx);
  const match = PROXY_RE.exec(pathname);
  if (!match) return;
  const port = Number(match[1]);
  if (port < 1 || port > 65535) return;
  const path = (match[2] || "/") + query;
  return { port, path };
}

// Normalize a base URL to either `""` (root) or `/foo/bar` (no trailing slash).
function normalizeBaseURL(input: string | undefined): string {
  if (!input || input === "/") return "";
  let result = input.trim();
  if (!result.startsWith("/")) result = "/" + result;
  while (result.endsWith("/")) result = result.slice(0, -1);
  return result;
}

// Strip the normalized base URL from a request URL. Leaves the URL untouched
// if it doesn't sit under the base.
function stripBaseURL(url: string, baseURL: string): string {
  if (!baseURL) return url;
  if (url === baseURL) return "/";
  if (url.startsWith(baseURL + "/") || url.startsWith(baseURL + "?")) {
    return url.slice(baseURL.length) || "/";
  }
  return url;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
