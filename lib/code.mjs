import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Auto-updated by scripts/pack.ts
const codeArchiveHash = "bb8e0fd2638133e1";

const archivePath = fileURLToPath(new URL("./code.tar.zst", import.meta.url));

const verbose = !!process.env.DEBUG;

const gray = (str) => `\x1b[90m${str}\x1b[0m`;
const log = (...args) => console.log(gray(`[coderaft] ${args.join(" ")}`));
const vlog = verbose ? log : () => {};

export async function loadCode() {
  if (process.env.CODE_MODULES_DIR) {
    vlog(`Using CODE_MODULES_DIR: ${process.env.CODE_MODULES_DIR}`);
    return { modulesDir: resolve(process.env.CODE_MODULES_DIR) };
  }

  const cacheDir = join(tmpdir(), "coderaft", codeArchiveHash);
  const modulesDir = join(cacheDir, "node_modules");
  const markerPath = join(cacheDir, ".complete");

  if (existsSync(markerPath) && readFileSync(markerPath, "utf8") === codeArchiveHash) {
    vlog(`Cache hit: ${cacheDir}`);
    return { modulesDir };
  }

  if (!existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  mkdirSync(cacheDir, { recursive: true });

  vlog(`Extracting... (${cacheDir})`);
  const start = performance.now();

  const { extractTarZst } = await import("./tar.mjs");
  await extractTarZst(archivePath, cacheDir);

  writeFileSync(markerPath, codeArchiveHash);
  vlog(`Extracted in ${(performance.now() - start).toFixed(0)}ms`);

  return { modulesDir };
}
