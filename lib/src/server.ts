import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { serveStatic } from "./static.ts";
import type { VSCodeServerOptions } from "./types.ts";
import { loadCode } from "#code";

// Android/Termux reports process.platform as "android" which VS Code's bundled
// platform switches don't handle (only "win32", "darwin", "linux"). Remap it to
// "linux" early so all downstream code (ptyHost, agentHost, server-main) works.
// We also inject it via NODE_OPTIONS so forked child processes (ptyHost,
// agentHost, file watcher) inherit the fix automatically.
if (process.platform === "android") {
  Object.defineProperty(process, "platform", { value: "linux" });
  const preload = `--import "data:text/javascript,Object.defineProperty(process,'platform',{value:'linux'})"`;
  process.env.NODE_OPTIONS = process.env.NODE_OPTIONS
    ? `${process.env.NODE_OPTIONS} ${preload}`
    : preload;
}

// Access `os` via CJS require — NOT via a top-level ESM import. When Node sees
// `import … from "node:os"` it creates an ESM wrapper whose named-export
// bindings point directly at the original native functions and are immutable.
// VS Code's bundled server-main.js uses `import { networkInterfaces } from "os"`
// which resolves through that same wrapper. Patching the CJS exports object
// *before* any ESM import of "os" exists ensures the ESM wrapper (created lazily
// on first `import "os"`) picks up our patched function.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _os: typeof import("node:os") = process.getBuiltinModule?.("os");

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
  /** Connection token (shared auth secret). Auto-generated if omitted. */
  connectionToken?: string;
  /** Host/interface to bind (used to infer local-only access for token default). */
  host?: string;
  /** Extra options forwarded to VS Code's `createServer()`. */
  vscode?: VSCodeServerOptions;
}

export interface StartCodeServerOptions extends CreateCodeServerOptions {
  /** TCP port to listen on. Defaults to `$PORT` or `6063`. */
  port?: number;
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
  port: number;
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

  // Ensure `os.networkInterfaces()` always returns at least one interface with a
  // valid MAC. On Termux/Android no real NICs are exposed, causing VS Code's
  // `getMacAddress()` to throw "Unable to retrieve mac address (unexpected
  // format)". The machineId then falls back to a random UUID on every boot.
  // Patching in a deterministic dummy MAC derived from the hostname gives a
  // stable machineId without touching upstream code.
  ensureNetworkInterface();

  // Load VS Code server module — mute noisy internal logs during init
  const _log = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("[reconnection-grace-time]")) return;
    // Suppress VS Code's empty startup banner (timestamp + newlines)
    if (args.length === 2 && typeof args[1] === "string" && !args[1].trim()) return;
    _log(...args);
  };
  const mod = await import(join(vsRootPath, "out/server-main.js"));
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
    handleUpgrade(req: IncomingMessage, socket: Duplex, _head: Buffer) {
      vscodeServer.handleUpgrade(req, socket);
    },
    async dispose() {
      vscodeServer.dispose();
    },
  };
}

export async function startCodeServer(
  opts: StartCodeServerOptions = {},
): Promise<CodeServerHandle> {
  const port = opts.port ?? (Number(process.env.PORT) || 6063);
  const handler = await createCodeServer(opts);

  const server = createServer((req, res) => {
    handler.handleRequest(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    handler.handleUpgrade(req, socket, head);
  });

  const listen = (p: number) =>
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

  try {
    await listen(port);
  } catch (err: any) {
    if (err?.code === "EADDRINUSE") {
      await listen(0);
    } else {
      throw err;
    }
  }

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

function ensureNetworkInterface(): void {
  const original = _os.networkInterfaces;
  const BLACKLISTED = new Set(["00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "ac:de:48:00:11:22"]);
  _os.networkInterfaces = function networkInterfaces() {
    const ifaces = original.call(_os);
    for (const name in ifaces) {
      for (const info of ifaces[name]!) {
        if (info.mac && !BLACKLISTED.has(info.mac)) return ifaces;
      }
    }
    // No valid MAC found — inject a deterministic one derived from hostname
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    const hash = createHash("md5").update(_os.hostname()).digest();
    // Format as a locally-administered unicast MAC (set bit 1 of first octet)
    hash[0] = (hash[0]! | 0x02) & 0xfe;
    const mac = [...hash.subarray(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join(":");
    ifaces._coderaft = [
      {
        address: "10.0.0.1",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac,
        internal: false,
        cidr: "10.0.0.1/24",
      },
    ];
    return ifaces;
  } as typeof _os.networkInterfaces;
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
