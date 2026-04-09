#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { platform } from "node:os";

const maxSizeMB = platform() === "darwin" ? 35 : 25;

const libDir = join(import.meta.dirname!, "../lib");
const nodeModulesDir = join(libDir, "node_modules");

if (!existsSync(nodeModulesDir)) {
  console.error("lib/node_modules not found. Run `pnpm install` first.");
  process.exit(1);
}

const outFile = join(libDir, "code.tar.zst");

const excludeDirs = new Set([".bin"]);
const excludeDirPaths = new Set(["katex/src"]);
const excludeExts = new Set([".d.ts", ".map"]);
const excludeNames = new Set(["README.md", "LICENSE", "LICENSE.md", "LICENSE.txt"]);

const tarExcludes = [
  "node_modules/.bin",
  "node_modules/katex/src",
  "*.d.ts",
  "*.map",
  "README.md",
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
]
  .map((p) => `--exclude='${p}'`)
  .join(" ");

// Hash node_modules content deterministically (independent of tar metadata)
console.log("Hashing lib/node_modules...");

function shouldExclude(name: string): boolean {
  if (excludeNames.has(name)) return true;
  for (const ext of excludeExts) {
    if (name.endsWith(ext)) return true;
  }
  return false;
}

function collectFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const isSymlink = entry.isSymbolicLink();
    const isDir =
      entry.isDirectory() ||
      (isSymlink && statSync(fullPath, { throwIfNoEntry: false })?.isDirectory());
    if (isDir) {
      if (excludeDirs.has(entry.name)) continue;
      if (excludeDirPaths.has(relative(nodeModulesDir, fullPath))) continue;
      collectFiles(fullPath, files);
    } else if (entry.isFile() || isSymlink) {
      if (shouldExclude(entry.name)) continue;
      files.push(relative(nodeModulesDir, fullPath));
    }
  }
  return files;
}

const files = collectFiles(nodeModulesDir).sort();
const overallHash = createHash("sha256");
const lines: string[] = [];
for (const file of files) {
  const content = readFileSync(join(nodeModulesDir, file));
  const fileHash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  overallHash.update(file);
  overallHash.update(content);
  lines.push(`${fileHash}  ${file}`);
}
const contentHash = overallHash.digest("hex").slice(0, 16);

// Write file listing with per-file hashes for inspection
writeFileSync(outFile + ".txt", lines.join("\n") + "\n");

// Update hash in code.mjs (only if changed)
const codeMjsPath = join(libDir, "code.mjs");
const codeMjs = readFileSync(codeMjsPath, "utf8");
const updatedCodeMjs = codeMjs.replace(
  /const codeArchiveHash = ".*/,
  `const codeArchiveHash = "${contentHash}";`,
);
const hashChanged = updatedCodeMjs !== codeMjs;

if (hashChanged || !existsSync(outFile)) {
  console.log("Packing lib/node_modules...");
  execSync(`tar -C ${libDir} ${tarExcludes} -chf - node_modules | zstd -19 -T0 -f -o ${outFile}`, {
    stdio: "inherit",
  });
  const sizeBytes = statSync(outFile).size;
  const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
  console.log(`Packed to ${outFile} (${sizeMB} MB, hash: ${contentHash})`);
  if (sizeBytes > maxSizeMB * 1024 * 1024) {
    console.error(`ERROR: Archive size (${sizeMB} MB) exceeds ${maxSizeMB} MiB limit!`);
    process.exit(1);
  }
} else {
  const sizeBytes = statSync(outFile).size;
  const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
  console.log(`Archive unchanged (${sizeMB} MB, hash: ${contentHash})`);
  if (sizeBytes > maxSizeMB * 1024 * 1024) {
    console.error(`ERROR: Archive size (${sizeMB} MB) exceeds ${maxSizeMB} MiB limit!`);
    process.exit(1);
  }
}

if (hashChanged) {
  writeFileSync(codeMjsPath, updatedCodeMjs);
  console.log("Updated codeArchiveHash in code.mjs");
}
