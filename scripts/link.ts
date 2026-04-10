#!/usr/bin/env node
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  rmSync,
} from "node:fs";

const rootDir = join(import.meta.dirname!, "..");
const workspacePkgDir = join(rootDir, "lib");
const require = createRequire(join(workspacePkgDir, "index.js"));
const codeServerDir = dirname(require.resolve("code-server/package.json"));
const workspaceNodeModules = join(workspacePkgDir, "node_modules");
const shimsDir = join(rootDir, "shims");

// Extra packages to link that aren't declared in package.json (conditionally loaded at runtime)
const extraDeps = ["vsda", "@vscode/fs-copyfile"];

// Link extra deps into workspace node_modules so tar -ch can resolve them
for (const dep of extraDeps) {
  const linkPath = join(workspaceNodeModules, dep);
  if (existsSync(linkPath)) continue;
  let resolvedPath: string | null = null;
  try {
    resolvedPath = dirname(require.resolve(`${dep}/package.json`));
  } catch {}
  if (!resolvedPath) continue;
  if (dep.startsWith("@")) {
    mkdirSync(dirname(linkPath), { recursive: true });
  }
  try {
    rmSync(linkPath, { recursive: true });
  } catch {}
  symlinkSync(realpathSync(resolvedPath), linkPath);
  console.log(`Linked extra dep ${dep} → ${resolvedPath}`);
}

// Directories that need their own node_modules populated
const targets = [join(codeServerDir, "lib/vscode"), join(codeServerDir, "lib/vscode/extensions")];

for (const targetDir of targets) {
  const pkgPath = join(targetDir, "package.json");
  if (!existsSync(pkgPath)) continue;

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const topDeps = [...new Set([...Object.keys(pkg.dependencies || {}), ...extraDeps])];

  // Collect top-level deps (name -> realpath)
  const collected = new Map<string, string>();
  const skippedDeps: string[] = [];
  for (const dep of topDeps) {
    // Try workspace node_modules first, then fall back to shims directory
    const candidatePath = join(workspaceNodeModules, dep);
    const shimPath = join(shimsDir, dep);
    const sourcePath = existsSync(candidatePath)
      ? candidatePath
      : existsSync(shimPath)
        ? shimPath
        : null;
    if (!sourcePath) {
      skippedDeps.push(dep);
      continue;
    }
    collected.set(dep, realpathSync(sourcePath));
  }

  // Walk transitive deps. pnpm's flat layout stores siblings at
  // `.pnpm/<pkg>@<ver>/node_modules/*`, so when `tar -ch` dereferences the
  // top-level symlink it only captures <pkg>'s own files. We need to also
  // link those siblings into the target node_modules.
  const queue = [...collected.values()];
  while (queue.length > 0) {
    const realPath = queue.shift()!;
    const pkgJsonPath = join(realPath, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    let depPkg: any;
    try {
      depPkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    } catch {
      continue;
    }
    const childDeps = [
      ...Object.keys(depPkg.dependencies || {}),
      ...Object.keys(depPkg.optionalDependencies || {}),
    ];
    for (const child of childDeps) {
      if (collected.has(child)) continue;
      const source = resolveDepFrom(realPath, child);
      if (!source) continue;
      const childReal = realpathSync(source);
      collected.set(child, childReal);
      queue.push(childReal);
    }
  }

  // Clean up stale node_modules before linking
  const nodeModulesDir = join(targetDir, "node_modules");
  if (existsSync(nodeModulesDir)) {
    rmSync(nodeModulesDir, { recursive: true });
  }
  mkdirSync(nodeModulesDir, { recursive: true });

  const linkedTop: string[] = [];
  const linkedTransitive: string[] = [];
  for (const [dep, resolvedDir] of collected) {
    const linkPath = join(nodeModulesDir, dep);

    // Ensure parent dir exists for scoped packages (@scope/name)
    if (dep.startsWith("@")) {
      mkdirSync(dirname(linkPath), { recursive: true });
    }

    if (existsSync(linkPath)) {
      rmSync(linkPath, { recursive: true });
    }
    symlinkSync(resolvedDir, linkPath);
    if (topDeps.includes(dep)) linkedTop.push(dep);
    else linkedTransitive.push(dep);
  }

  console.log(
    `Linked ${linkedTop.length}/${topDeps.length} top-level + ${linkedTransitive.length} transitive into ${targetDir}/node_modules`,
  );
  for (const dep of linkedTop) {
    console.log(`  + ${dep}`);
  }
  for (const dep of linkedTransitive) {
    console.log(`  ~ ${dep}`);
  }
  for (const dep of skippedDeps) {
    console.warn(`  ! ${dep} (not found, skipped)`);
  }
}

// Resolve a dep from `fromPkgRealPath`, handling both nested (shim) and
// pnpm-flat (sibling under the nearest node_modules) layouts.
function resolveDepFrom(fromPkgRealPath: string, depName: string): string | null {
  const own = join(fromPkgRealPath, "node_modules", depName);
  if (existsSync(own)) return own;
  let current = fromPkgRealPath;
  while (true) {
    const parent = dirname(current);
    if (parent === current) return null;
    if (basename(parent) === "node_modules") {
      const sibling = join(parent, depName);
      return existsSync(sibling) ? sibling : null;
    }
    current = parent;
  }
}

// Copy code-server's ThirdPartyNotices.txt into the workspace package
const notices = join(codeServerDir, "ThirdPartyNotices.txt");
const noticesLink = join(workspacePkgDir, "ThirdPartyNotices.txt");
if (existsSync(notices)) {
  if (existsSync(noticesLink)) rmSync(noticesLink);
  copyFileSync(notices, noticesLink);
  console.log(`Copied ThirdPartyNotices.txt from ${notices}`);
}
