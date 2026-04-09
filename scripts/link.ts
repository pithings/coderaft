#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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
  try { rmSync(linkPath, { recursive: true }); } catch {}
  symlinkSync(realpathSync(resolvedPath), linkPath);
  console.log(`Linked extra dep ${dep} → ${resolvedPath}`);
}

// Directories that need their own node_modules populated
const targets = [join(codeServerDir, "lib/vscode"), join(codeServerDir, "lib/vscode/extensions")];

for (const targetDir of targets) {
  const pkgPath = join(targetDir, "package.json");
  if (!existsSync(pkgPath)) continue;

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const deps = [...new Set([...Object.keys(pkg.dependencies || {}), ...extraDeps])];

  // Clean up stale node_modules before linking
  const nodeModulesDir = join(targetDir, "node_modules");
  if (existsSync(nodeModulesDir)) {
    rmSync(nodeModulesDir, { recursive: true });
  }
  mkdirSync(nodeModulesDir, { recursive: true });

  const linkedDeps: string[] = [];
  const skippedDeps: string[] = [];
  for (const dep of deps) {
    const linkPath = join(nodeModulesDir, dep);

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
    const resolvedDir = realpathSync(sourcePath);

    // Ensure parent dir exists for scoped packages (@scope/name)
    if (dep.startsWith("@")) {
      mkdirSync(dirname(linkPath), { recursive: true });
    }

    // Remove existing link/dir and create symlink
    if (existsSync(linkPath)) {
      rmSync(linkPath, { recursive: true });
    }
    symlinkSync(resolvedDir, linkPath);
    linkedDeps.push(dep);
  }

  console.log(
    `Linked ${linkedDeps.length}/${deps.length} dependencies into ${targetDir}/node_modules`,
  );
  for (const dep of linkedDeps) {
    console.log(`  + ${dep}`);
  }
  for (const dep of skippedDeps) {
    console.warn(`  ! ${dep} (not found, skipped)`);
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
