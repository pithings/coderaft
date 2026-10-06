import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";

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
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain",
};

// Formats worth compressing — text, plus wasm / ttf / ico which shrink 2-3x.
// Already-compressed formats (png, woff2, …) are served as-is.
const COMPRESSIBLE_EXT = new Set([
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".json",
  ".svg",
  ".map",
  ".txt",
  ".wasm",
  ".ttf",
  ".ico",
]);

// Below this size the encoding overhead isn't worth a cache entry.
const MIN_COMPRESS_SIZE = 1024;

type Encoding = "br" | "gzip";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

// Compressed bodies keyed by encoding + path + mtime + size. Served files live
// in the extracted code tree, which doesn't change under a running server, and
// the set of distinct assets clients request is small and bounded (~10 MiB
// compressed for a full workbench). The promise is cached so concurrent cold
// requests share a single compression.
const compressedCache = new Map<string, Promise<Buffer>>();

/**
 * Serve a file rooted at `root`, with path-traversal guard. Returns `true` if
 * the response was written (either the file or a 4xx), `false` if the caller
 * should fall through to the next handler.
 *
 * Compressible assets are sent brotli/gzip-encoded when the client accepts it
 * — the VS Code workbench bundle is ~18 MiB raw but ~4 MiB brotli, which
 * dominates first load over slow links.
 */
export async function serveStatic(
  req: IncomingMessage,
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
    const ext = extname(abs).toLowerCase();
    const headers: Record<string, string | number> = {
      "Content-Type": STATIC_MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    // Broaden service worker scope from `/_static/out/browser/` to `/`, same
    // as coder's express.static setHeaders hook does.
    if (abs.endsWith("/serviceWorker.js")) {
      headers["Service-Worker-Allowed"] = "/";
    }

    const compressible = COMPRESSIBLE_EXT.has(ext) && st.size >= MIN_COMPRESS_SIZE;
    if (compressible) headers["Vary"] = "Accept-Encoding";
    const encoding = compressible ? negotiateEncoding(req.headers["accept-encoding"]) : undefined;
    if (encoding) {
      const key = `${encoding}:${abs}:${st.mtimeMs}:${st.size}`;
      let body = compressedCache.get(key);
      if (!body) {
        body = compressFile(abs, encoding);
        compressedCache.set(key, body);
        body.catch(() => compressedCache.delete(key));
      }
      const buf = await body;
      headers["Content-Encoding"] = encoding;
      headers["Content-Length"] = buf.length;
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : buf);
      return true;
    }

    headers["Content-Length"] = st.size;
    res.writeHead(200, headers);
    if (req.method === "HEAD") res.end();
    else createReadStream(abs).pipe(res);
    return true;
  } catch {
    return false;
  }
}

async function compressFile(abs: string, encoding: Encoding): Promise<Buffer> {
  const raw = await readFile(abs);
  if (encoding === "br") {
    // Quality 5 is the sweet spot for on-the-fly brotli: the 18 MiB workbench
    // bundle compresses in ~0.3s to within ~15% of quality 11 (which takes
    // ~25s). It runs once per file per process.
    return brotliAsync(raw, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
  }
  return gzipAsync(raw, { level: 6 });
}

function negotiateEncoding(acceptEncoding: string | string[] | undefined): Encoding | undefined {
  const value = Array.isArray(acceptEncoding) ? acceptEncoding.join(",") : acceptEncoding;
  if (!value) return undefined;
  const accepted = new Set<string>();
  for (const part of value.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (q && Number(q.slice(2)) === 0) continue;
    accepted.add(name);
  }
  if (accepted.has("br")) return "br";
  if (accepted.has("gzip")) return "gzip";
  return undefined;
}
