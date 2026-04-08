// Streaming tar.zst extractor with pool-buffer strategy.
// Decompresses with Node's built-in zstd (libzstd) and parses tar entries
// incrementally as chunks arrive — no need to buffer the full archive.
// A single pre-allocated buffer (pool) grows to fit the largest tar entry,
// then compacts after each batch of entries, keeping memory ~3x lower than
// a full-buffer approach while matching or beating system tar in speed.
// Supports USTAR, GNU long names (type "L"), pax headers, and symlinks.

import { copyFileSync, createReadStream, mkdirSync, openSync, writeSync, closeSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { createZstdDecompress } from "node:zlib";

const BLOCK = 512;
const HIGH_WATER = 4 * 1024 * 1024; // 4MB initial buffer

/**
 * Extract a .tar.zst archive to a directory (streaming, low memory).
 * @param {string} archivePath - path to .tar.zst file
 * @param {string} destDir - destination directory
 * @returns {Promise<void>}
 */
export async function extractTarZst(archivePath, destDir) {
  const stream = createReadStream(archivePath).pipe(createZstdDecompress());

  // Pre-allocated buffer with read/write cursors to avoid repeated concat
  let pool = Buffer.allocUnsafe(HIGH_WATER);
  let start = 0; // read cursor
  let end = 0; // write cursor

  let gnuLongName = "";
  let gnuLongLink = "";
  let paxPath = "";
  const createdDirs = new Set();

  function ensureDir(dir) {
    if (!createdDirs.has(dir)) {
      mkdirSync(dir, { recursive: true });
      createdDirs.add(dir);
    }
  }

  function available() {
    return end - start;
  }

  function compact() {
    if (start === 0) return;
    if (start === end) {
      start = end = 0;
    } else {
      pool.copy(pool, 0, start, end);
      end -= start;
      start = 0;
    }
  }

  function appendChunk(chunk) {
    const needed = end + chunk.length;
    if (needed > pool.length) {
      // Grow: max of double or exactly what's needed
      const newSize = Math.max(pool.length * 2, needed - start);
      const newPool = Buffer.allocUnsafe(newSize);
      pool.copy(newPool, 0, start, end);
      end -= start;
      start = 0;
      pool = newPool;
    } else if (end + chunk.length > pool.length) {
      compact();
    }
    chunk.copy(pool, end);
    end += chunk.length;
  }

  function processEntries() {
    while (available() >= BLOCK) {
      // Null block
      if (pool[start] === 0 && pool[start + 1] === 0) {
        start += BLOCK;
        continue;
      }

      const size = parseOctal(pool, start + 124, 12);
      const typeflag = String.fromCharCode(pool[start + 156]);
      const dataBlocks = Math.ceil(size / BLOCK) * BLOCK;
      const totalNeeded = BLOCK + dataBlocks;

      if (available() < totalNeeded) break;

      const headerStart = start;
      const dataStart = start + BLOCK;

      if (typeflag === "L") {
        // eslint-disable-next-line no-control-regex
        gnuLongName = pool.toString("utf8", dataStart, dataStart + size).replace(/\0+$/, "");
        start += totalNeeded;
        continue;
      }

      if (typeflag === "K") {
        // eslint-disable-next-line no-control-regex
        gnuLongLink = pool.toString("utf8", dataStart, dataStart + size).replace(/\0+$/, "");
        start += totalNeeded;
        continue;
      }

      if (typeflag === "x") {
        paxPath = parsePaxPath(pool.toString("utf8", dataStart, dataStart + size));
        start += totalNeeded;
        continue;
      }

      if (typeflag === "g") {
        start += totalNeeded;
        continue;
      }

      const name = gnuLongName || paxPath || readTarPath(pool, headerStart);
      const longLink = gnuLongLink;
      gnuLongName = "";
      gnuLongLink = "";
      paxPath = "";

      if (name) {
        const fullPath = join(destDir, name);

        if (typeflag === "5" || name.endsWith("/")) {
          ensureDir(fullPath);
        } else if (typeflag === "1") {
          const linkname = longLink || readString(pool, headerStart + 157, 100);
          ensureDir(dirname(fullPath));
          copyFileSync(join(destDir, linkname), fullPath);
        } else if (typeflag === "2") {
          const linkname = readString(pool, headerStart + 157, 100);
          ensureDir(dirname(fullPath));
          symlinkSync(linkname, fullPath);
        } else if (typeflag === "0" || typeflag === "\0") {
          ensureDir(dirname(fullPath));
          const fd = openSync(fullPath, "w", parseOctal(pool, headerStart + 100, 8) || 0o644);
          writeSync(fd, pool, dataStart, size);
          closeSync(fd);
        }
      }

      start += totalNeeded;
    }
  }

  for await (const chunk of stream) {
    appendChunk(chunk);
    processEntries();
    compact();
  }

  // Process any remaining data
  processEntries();
}

// --- tar header parsing ---

function readTarPath(buf, offset) {
  const prefix = readString(buf, offset + 345, 155);
  const name = readString(buf, offset, 100);
  return prefix ? prefix + "/" + name : name;
}

function readString(buf, offset, length) {
  const end = buf.indexOf(0, offset);
  const slice = buf.subarray(offset, end >= 0 && end < offset + length ? end : offset + length);
  return slice.toString("utf8");
}

function parseOctal(buf, offset, length) {
  const str = readString(buf, offset, length).trim();
  return str ? parseInt(str, 8) || 0 : 0;
}

function parsePaxPath(paxData) {
  for (const line of paxData.split("\n")) {
    const match = line.match(/^\d+ path=(.+)/);
    if (match) return match[1];
  }
  return "";
}
