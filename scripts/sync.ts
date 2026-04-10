#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const workspacePkgDir = join(import.meta.dirname!, "../lib");
const require = createRequire(join(workspacePkgDir, "index.js"));
const codeServerDir = dirname(require.resolve("code-server/package.json"));

const vscodePkg = JSON.parse(readFileSync(join(codeServerDir, "lib/vscode/package.json"), "utf8"));
const extensionsPkg = JSON.parse(
  readFileSync(join(codeServerDir, "lib/vscode/extensions/package.json"), "utf8"),
);

// Extra deps required at runtime by bundled extensions but not declared
// in any upstream package.json (e.g. the git extension bundles a require
// for `@vscode/fs-copyfile` without listing it as a dependency).
const extraDeps: Record<string, string> = {
  "@vscode/fs-copyfile": "workspace:*",
};

// Upstream deps that are not referenced by any bundled code path and
// should never be installed (keeps the dep tree lean).
const excludedDeps = new Set<string>([
  "@anthropic-ai/sandbox-runtime",
  // Bundled into dist by obuild (see lib/dist/_chunks/libs/httpxy.mjs),
  // so it must not be listed as a runtime dep.
  "httpxy",
]);

// Merge and sort all nested dependencies
const nestedDeps: Record<string, string> = Object.fromEntries(
  Object.entries<string>({
    ...vscodePkg.dependencies,
    ...extensionsPkg.dependencies,
    ...extraDeps,
  })
    .filter(([name]) => !excludedDeps.has(name))
    .sort(([a], [b]) => a.localeCompare(b)),
);

// Read the workspace package.json
const pkgPath = join(workspacePkgDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const prevDeps = pkg.devDependencies || {};

// Replace all devDependencies (keep code-server and workspace:* refs)
pkg.devDependencies = {
  "code-server": prevDeps["code-server"] || "^4.114.0",
  ...nestedDeps,
};
for (const [name, version] of Object.entries<string>(prevDeps)) {
  if (version.startsWith("workspace:")) {
    pkg.devDependencies[name] = version;
  }
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// Report changes (compare against final state, not raw upstream)
const finalDeps = pkg.devDependencies;
const added = Object.keys(finalDeps).filter((k) => k !== "code-server" && !(k in prevDeps));
const removed = Object.keys(prevDeps).filter((k) => k !== "code-server" && !(k in finalDeps));
const updated = Object.keys(finalDeps).filter(
  (k) => k !== "code-server" && k in prevDeps && prevDeps[k] !== finalDeps[k],
);

if (added.length) {
  console.log(`Added ${added.length} dependencies:`);
  for (const name of added) console.log(`  + ${name}`);
}
if (updated.length) {
  console.log(`Updated ${updated.length} dependencies:`);
  for (const name of updated) console.log(`  ~ ${name}: ${prevDeps[name]} → ${finalDeps[name]}`);
}
if (removed.length) {
  console.log(`Removed ${removed.length} dependencies:`);
  for (const name of removed) console.log(`  - ${name}`);
}
if (!added.length && !updated.length && !removed.length) {
  console.log("Dependencies already in sync.");
}
