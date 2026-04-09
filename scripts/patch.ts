#!/usr/bin/env node
// Regenerates patches/code-server.patch
// Usage: node scripts/patch.ts
//
// Workflow:
//   1. Run `pnpm patch code-server` to get a clean copy
//   2. This script applies the ESM hook fix to the clean copy
//   3. Run `pnpm patch-commit <path>` to commit the patch
//
// ## What this patches
//
// VS Code's extension host registers an ESM resolve hook (`module.register()`)
// to intercept `import "vscode"`. The hook runs in a worker thread and uses a
// `MessageChannel` to ask the main thread to resolve the API for each caller.
//
// On Node >=24, `require()` of ESM (and ESM `import()` in certain code paths)
// goes through `syncLink`, which blocks the main thread with `Atomics.wait()`
// until the hook responds. But the hook's response comes via `MessageChannel`
// `port.postMessage()` — which needs the main thread's event loop to deliver.
// The main thread can't process the message because it's blocked. Deadlock.
//
// ## How the fix works
//
// Instead of a MessageChannel round-trip during `resolve()`, the patched hook
// returns an inline `data:` URI module. This module calls
// `globalThis._VSCODE_IMPORT_VSCODE_API(callerUrl)` at **evaluation time**
// (when `syncLink` has already returned and the main thread is free), then
// re-exports the API's named properties as static ESM exports.
//
// The export list is hardcoded to match VS Code's stable API surface. When
// upgrading code-server, verify the list still matches by checking the return
// object in VS Code's `createApiFactoryAndRegisterStub` (search for
// `version:.*commands:.*window:.*workspace:` in extensionHostProcess.js).

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const rootDir = join(import.meta.dirname!, "..");

// Clean up any leftover patch dir from a previous run
rmSync(join(rootDir, "node_modules/.pnpm_patches"), {
  recursive: true,
  force: true,
});

// Step 1: Start pnpm patch to get a clean (unpatched) copy
const patchOutput = execSync("pnpm patch code-server --ignore-existing", {
  encoding: "utf8",
  cwd: rootDir,
});

const patchDir = patchOutput.match(/pnpm patch-commit '([^']+)'/)?.[1];
if (!patchDir) {
  console.error("Failed to parse pnpm patch output:", patchOutput);
  process.exit(1);
}

// Step 2: Apply the ESM hook fix
const extHostPath = `${patchDir}/lib/vscode/out/vs/workbench/api/node/extensionHostProcess.js`;
let code = readFileSync(extHostPath, "utf8");

// Dynamically extract the vscode API export list from the factory return object.
// This finds `return{version:...,commands:...,FileType:...}` in createApiFactoryAndRegisterStub.
const exports = extractApiExports(code);
console.log(`Found ${exports.length} vscode API exports`);

// VS Code's broken _loaderScript uses MessageChannel round-trip during resolve,
// which deadlocks on Node >=24 (syncLink blocks main thread with Atomics.wait).
// Replace with an inline data URI approach that resolves at evaluation time.
const brokenHook = `_loaderScript=\`
\tlet lookup;
\texport const initialize = async (context) => {
\t\tlet requestIds = 0;
\t\tconst { port } = context;
\t\tconst pendingRequests = new Map();
\t\tport.onmessage = (event) => {
\t\t\tconst { id, url } = event.data;
\t\t\tpendingRequests.get(id)?.(url);
\t\t};
\t\tlookup = url => {
\t\t\t// debugger;
\t\t\tconst myId = requestIds++;
\t\t\treturn new Promise((resolve) => {
\t\t\t\tpendingRequests.set(myId, resolve);
\t\t\t\tport.postMessage({ id: myId, url, });
\t\t\t});
\t\t};
\t};
\texport const resolve = async (specifier, context, nextResolve) => {
\t\tif (specifier !== 'vscode' || !context.parentURL) {
\t\t\treturn nextResolve(specifier, context);
\t\t}
\t\tconst otherUrl = await lookup(context.parentURL);
\t\treturn {
\t\t\turl: otherUrl,
\t\t\tshortCircuit: true,
\t\t};
\t};\``;

const exportList = JSON.stringify(exports);
const fixedHook = `_loaderScript=\`
\tconst EXPORTS = ${exportList};
\texport const initialize = async () => {};
\texport const resolve = async (specifier, context, nextResolve) => {
\t\tif (specifier !== 'vscode' || !context.parentURL) {
\t\t\treturn nextResolve(specifier, context);
\t\t}
\t\tconst callerUrl = encodeURIComponent(context.parentURL);
\t\tconst code = "const _api = globalThis._VSCODE_IMPORT_VSCODE_API(decodeURIComponent('" + callerUrl + "'));\\\\n"
\t\t\t+ EXPORTS.map(k => "export const " + k + " = _api['" + k + "'];").join("\\\\n");
\t\treturn { url: "data:text/javascript," + encodeURIComponent(code), shortCircuit: true };
\t};\``;

if (!code.includes(brokenHook)) {
  console.error("Cannot patch — broken hook pattern not found (already patched or source changed)");
  process.exit(1);
}

code = code.replace(brokenHook, fixedHook);

// Remove MessageChannel + transferList registration (fixed hook doesn't need a port)
code = code.replace(
  /register\(r\._createDataUri\(r\._loaderScript\),\{parentURL:import\.meta\.url,data:\{port:i\},transferList:\[i\]\}\)/,
  "register(r._createDataUri(r._loaderScript),{parentURL:import.meta.url})",
);

writeFileSync(extHostPath, code);

// Step 3: Commit the patch
execSync(`pnpm patch-commit '${patchDir}'`, {
  encoding: "utf8",
  stdio: "inherit",
  cwd: rootDir,
});

console.log("Patch regenerated successfully");

// --- Internal helpers ---

/** Extract all export names from the vscode API factory return object. */
function extractApiExports(source: string): string[] {
  // Match `return{version:...,commands:...,FileType:...}` in createApiFactoryAndRegisterStub
  const re = /return\s*\{[^}]*version\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const start = m.index;
    let depth = 0;
    let end = start;
    for (let i = start; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    const block = source.substring(start, end);
    if (block.includes("commands") && block.includes("window") && block.includes("workspace")) {
      const inner = block.substring(block.indexOf("{") + 1, block.lastIndexOf("}"));
      const keys: string[] = [];
      const keyRe = /(\w+)\s*:/g;
      let km: RegExpExecArray | null;
      while ((km = keyRe.exec(inner)) !== null) {
        keys.push(km[1]!);
      }
      return keys;
    }
  }
  console.error("Cannot find vscode API factory return object in source");
  process.exit(1);
}
