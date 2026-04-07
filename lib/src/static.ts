import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const STATIC_MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain",
};

/**
 * Serve a file rooted at `root`, with path-traversal guard. Returns `true` if
 * the response was written (either the file or a 4xx), `false` if the caller
 * should fall through to the next handler.
 */
export async function serveStatic(
  res: ServerResponse,
  root: string,
  relPath: string,
): Promise<boolean> {
  const decoded = decodeURIComponent(relPath);
  const abs = normalize(join(root, decoded));
  if (abs !== root && !abs.startsWith(root + sep)) {
    res.writeHead(400).end("Bad request.");
    return true;
  }
  try {
    const st = await stat(abs);
    if (!st.isFile()) return false;
    const headers: Record<string, string | number> = {
      "Content-Type": STATIC_MIME[extname(abs).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    // Broaden service worker scope from `/_static/out/browser/` to `/`, same
    // as coder's express.static setHeaders hook does.
    if (abs.endsWith("/serviceWorker.js")) {
      headers["Service-Worker-Allowed"] = "/";
    }
    res.writeHead(200, headers);
    createReadStream(abs).pipe(res);
    return true;
  } catch {
    return false;
  }
}
