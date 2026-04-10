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
const excludeFilePaths = new Set([
  "@vscode/tree-sitter-wasm/wasm/tree-sitter-c-sharp.wasm",
  "@vscode/tree-sitter-wasm/wasm/tree-sitter-ruby.wasm",
  // Native MSAL broker (Linux-only ELF); extension falls back to browser OAuth when missing.
  "code-server/lib/vscode/extensions/microsoft-authentication/dist/libmsalruntime.so",
  "code-server/lib/vscode/extensions/microsoft-authentication/dist/msal-node-runtime.node",
]);
const excludeExts = new Set([".d.ts", ".map", ".mp3"]);
const excludeNameRe =
  /^(readme(\.md)?|license(\.md|\.txt)?|releases\.md|security\.md|changelog\.md|support\.md|code_of_conduct\.md|authors\.md)$/i;

const tarExcludes = [
  "node_modules/.bin",
  "node_modules/katex/src",
  "node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-c-sharp.wasm",
  "node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-ruby.wasm",
  "node_modules/code-server/lib/vscode/extensions/microsoft-authentication/dist/libmsalruntime.so",
  "node_modules/code-server/lib/vscode/extensions/microsoft-authentication/dist/msal-node-runtime.node",
  "*.map",
  "*.mp3",
  "README.md",
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
]
  .map((p) => `--exclude='${p}'`)
  .join(" ");

// TypeScript's lib.*.d.ts files are required by tsserver for IntelliSense.
const keepDts = new Set(["typescript/lib"]);

const extGroups: Record<string, string> = {
  js: "js",
  mjs: "js",
  cjs: "js",
  ts: "ts",
  mts: "ts",
  cts: "ts",
  dts: "ts",
};

type ExtStat = { count: number; size: number };
const stats = new Map<string, ExtStat>();
const knownGroups = new Set(Object.values(extGroups));

function extKey(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "(none)";
  return extGroups[ext] ?? ext;
}

function groupLabel(key: string): string {
  if (knownGroups.has(key)) return key;
  if (key === "(none)") return "(none)";
  return `.${key}`;
}

function trackFile(name: string, size: number): void {
  const key = extKey(name);
  const s = stats.get(key) ?? { count: 0, size: 0 };
  s.count++;
  s.size += size;
  stats.set(key, s);
}

function human(n: number): string {
  for (const unit of ["B", "KB", "MB", "GB"]) {
    if (n < 1024) return `${n.toFixed(1)} ${unit}`;
    n /= 1024;
  }
  return `${n.toFixed(1)} TB`;
}

function printStats(): void {
  const sorted = [...stats.entries()].sort((a, b) => b[1].size - a[1].size);
  const total = sorted.reduce((a, [, s]) => a + s.size, 0);
  const totalCount = sorted.reduce((a, [, s]) => a + s.count, 0);
  const rows: string[][] = sorted.map(([key, s]) => {
    const share = total ? (s.size / total) * 100 : 0;
    return [
      `\`${groupLabel(key)}\``,
      s.count.toLocaleString("en-US"),
      human(s.size),
      `${share.toFixed(1)}%`,
    ];
  });
  rows.push([
    `**Total**`,
    `**${totalCount.toLocaleString("en-US")}**`,
    `**${human(total)}**`,
    "**100%**",
  ]);

  const headers = ["Type", "Count", "Size", "Share"];
  const aligns: ("<" | ">")[] = ["<", ">", ">", ">"];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const pad = (c: string, a: "<" | ">", w: number) => (a === ">" ? c.padStart(w) : c.padEnd(w));
  const fmt = (cells: readonly string[]) =>
    "| " + cells.map((c, i) => pad(c, aligns[i]!, widths[i]!)).join(" | ") + " |";
  const sep =
    "|" +
    widths
      .map((w, i) => (aligns[i] === ">" ? "-".repeat(w + 1) + ":" : "-".repeat(w + 2)))
      .join("|") +
    "|";

  console.log(fmt(headers));
  console.log(sep);
  for (const r of rows) console.log(fmt(r));
}

// Hash node_modules content deterministically (independent of tar metadata)
console.log("Hashing lib/node_modules...");

function shouldExclude(name: string, relPath: string): boolean {
  if (excludeNameRe.test(name)) return true;
  if (excludeFilePaths.has(relPath)) return true;
  for (const ext of excludeExts) {
    if (name.endsWith(ext)) {
      // Keep .d.ts files required by tsserver for IntelliSense
      if (ext === ".d.ts") {
        for (const keep of keepDts) {
          if (relPath.includes(keep)) return false;
        }
      }
      return true;
    }
  }
  return false;
}

function collectFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const isSymlink = entry.isSymbolicLink();
    const stat = isSymlink ? statSync(fullPath, { throwIfNoEntry: false }) : undefined;
    const isDir = entry.isDirectory() || stat?.isDirectory();
    if (isDir) {
      if (excludeDirs.has(entry.name)) continue;
      if (excludeDirPaths.has(relative(nodeModulesDir, fullPath))) continue;
      collectFiles(fullPath, files);
    } else if (entry.isFile() || isSymlink) {
      const relPath = relative(nodeModulesDir, fullPath);
      if (shouldExclude(entry.name, relPath)) continue;
      files.push(relPath);
      trackFile(entry.name, stat?.size ?? statSync(fullPath).size);
    }
  }
  return files;
}

const files = collectFiles(nodeModulesDir).sort();
printStats();

const overallHash = createHash("sha256");
type FileInfo = { path: string; size: number; hash: string; key: string };
const fileInfos: FileInfo[] = [];
for (const file of files) {
  const content = readFileSync(join(nodeModulesDir, file));
  const fileHash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  overallHash.update(file);
  overallHash.update(content);
  const name = file.slice(file.lastIndexOf("/") + 1);
  fileInfos.push({ path: file, size: content.length, hash: fileHash, key: extKey(name) });
}
const contentHash = overallHash.digest("hex").slice(0, 16);

// Write file listing grouped by extension, sorted by size
const grouped = new Map<string, FileInfo[]>();
for (const info of fileInfos) {
  const arr = grouped.get(info.key) ?? [];
  arr.push(info);
  grouped.set(info.key, arr);
}
const groupOrder = [...grouped.entries()]
  .map(([key, arr]) => ({ key, files: arr, total: arr.reduce((a, f) => a + f.size, 0) }))
  .sort((a, b) => b.total - a.total);

const listingLines: string[] = [];
for (const g of groupOrder) {
  g.files.sort((a, b) => b.size - a.size);
  listingLines.push(
    `# ${groupLabel(g.key)} — ${g.files.length.toLocaleString("en-US")} files, ${human(g.total)}`,
  );
  const w = Math.max(...g.files.map((f) => human(f.size).length));
  for (const f of g.files) {
    listingLines.push(`${f.hash}  ${human(f.size).padStart(w)}  ${f.path}`);
  }
  listingLines.push("");
}
writeFileSync(outFile + ".txt", listingLines.join("\n"));

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
