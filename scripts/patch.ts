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

// Rewrite `_VSCODE_IMPORT_VSCODE_API` to load the vscode factory synchronously
// from the caller URL. Upstream keys it by UUID via MessageChannel round-trip
// (`e.getKey(uuid)`), but the fixed hook above passes the caller URL directly,
// so the UUID lookup returns undefined and extensions crash with
// `Cannot read properties of undefined (reading 'version')`. We capture the
// mangled names of the factory cache, assertion fn, and URI class from the
// surrounding (now-dead) onmessage handler so the rewrite tracks minifier
// renames across upgrades.
const interceptorRe =
  /value:(?<param>\w+)=>(?<mapVar>\w+)\.getKey\(\k<param>\)\}\);(?=let\{port1:\w+,port2:\w+\}=new MessageChannel,(?<factory>\w+),\w+=\w+;\w+\.onmessage=\w+=>\{\k<factory>\|\|\(\k<factory>=this\._factories\.get\("vscode"\),(?<assert>\w+)\(\k<factory>\)\);let\{id:\w+,url:\w+\}=\w+\.data,\w+=(?<uri>\w+)\.parse\()/;
const interceptorMatch = code.match(interceptorRe);
if (!interceptorMatch) {
  console.error("Cannot patch — _VSCODE_IMPORT_VSCODE_API interceptor pattern not found");
  process.exit(1);
}
const { param, mapVar, factory, assert: assertFn, uri } = interceptorMatch.groups!;
const interceptorOld = `value:${param}=>${mapVar}.getKey(${param})`;
const interceptorNew = `value:${param}=>{${factory}||(${factory}=this._factories.get("vscode"),${assertFn}(${factory}));return ${factory}.load("_not_used",${uri}.parse(${param}),()=>{throw new Error("CANNOT LOAD MODULE from here.")})}`;
code = code.replace(interceptorOld, interceptorNew);

// Remove MessageChannel + transferList registration (fixed hook doesn't need a port)
code = code.replace(
  /register\(r\._createDataUri\(r\._loaderScript\),\{parentURL:import\.meta\.url,data:\{port:i\},transferList:\[i\]\}\)/,
  "register(r._createDataUri(r._loaderScript),{parentURL:import.meta.url})",
);

writeFileSync(extHostPath, code);

// Step 2b: Fix `Platform not supported` throw in userDataPath switch.
//
// VS Code's `vs/platform/environment/node/userDataPath.ts` has a
// `switch (process.platform)` with a `default: throw new Error("Platform not
// supported")` branch. On Termux, `process.platform === "android"` hits that
// branch and crashes server/pty-host/agent-host startup. The same switch gets
// bundled into multiple entry files, so we patch each one.
//
// Fix: rewrite `case"linux":<body>;break;default:throw ...` so linux falls
// through from default, giving unknown platforms the XDG/~/.config code path.
const platformSwitchFiles = [
  "lib/vscode/out/server-main.js",
  "lib/vscode/out/vs/platform/terminal/node/ptyHostMain.js",
  "lib/vscode/out/vs/platform/agentHost/node/agentHostMain.js",
];

// Variable names (`Ht`, `va`, etc.) differ per bundle due to minification,
// so match them with a regex rather than literal strings.
const platformSwitchRe =
  /case"linux":((?:(?!break;).)*?)break;default:throw new Error\("Platform not supported"\)/;

for (const rel of platformSwitchFiles) {
  const filePath = `${patchDir}/${rel}`;
  let src = readFileSync(filePath, "utf8");
  const match = src.match(platformSwitchRe);
  if (!match) {
    console.error(`Cannot patch ${rel} — platform switch pattern not found`);
    process.exit(1);
  }
  src = src.replace(platformSwitchRe, `case"linux":default:${match[1]}break`);
  writeFileSync(filePath, src);
  console.log(`Patched platform switch in ${rel}`);
}

// Step 2c: Neuter the bundled Copilot Chat ("Build with Agent") wiring in
// product.json.
//
// The Copilot Chat extension files themselves are already stripped from the
// shipped tarball in `scripts/pack.ts`, but VS Code core still ships the chat
// UI (Chat view container, agent picker, "Build with Agent" heading) and
// reads `defaultChatAgent` / `builtInExtensionsEnabledWithAutoUpdates` from
// product.json to drive the onboarding flow. We remove those references so
// the bundled chat UI has nothing to wire up.
//
// String-level edits (not JSON.stringify) to keep the diff minimal — product.json
// uses a custom mixed compact/pretty layout that JSON.stringify would normalize.
const productJsonPath = `${patchDir}/lib/vscode/product.json`;
let productSrc = readFileSync(productJsonPath, "utf8");

// 1. Drop the `defaultChatAgent` object (multiline block, ends with `},\n`).
const defaultChatAgentRe = /^ {2}"defaultChatAgent": \{[\s\S]*?^ {2}\},\n/m;
if (!defaultChatAgentRe.test(productSrc)) {
  console.error("Cannot patch product.json — defaultChatAgent block not found");
  process.exit(1);
}
productSrc = productSrc.replace(defaultChatAgentRe, "");

// 2. Drop copilot entries from `trustedExtensionAuthAccess`.
productSrc = productSrc.replace(/, "github\.copilot(?:-chat)?"/g, "");

// 3. Empty `builtInExtensionsEnabledWithAutoUpdates`.
productSrc = productSrc.replace(
  /"builtInExtensionsEnabledWithAutoUpdates": \[[^\]]*\]/,
  '"builtInExtensionsEnabledWithAutoUpdates": []',
);

writeFileSync(productJsonPath, productSrc);
console.log("Patched product.json (chat agent/copilot wiring removed)");

// Step 2d: Inject default settings into the workbench config sent to the browser.
//
// We can't use product.json's `configurationDefaults` key — VS Code only reads
// `configurationDefaults` from extension `contributes` and from workbench
// `options.configurationDefaults`. The browser-side bootstrap registers them via
// `configurationRegistry.registerDefaultConfigurations([{overrides: options.configurationDefaults}])`.
//
// `server-main.js` builds the workbench options object `U` and serializes it
// into the `WORKBENCH_WEB_CONFIGURATION` meta tag. We inject `configurationDefaults`
// as the first key of `U` so the browser workbench applies the defaults.
//
// Both `chat.disableAIFeatures` AND `workbench.disableAICustomizations` must
// be true to fully hide the chat setup UI (e.g. the "Sign in to use AI
// Features" button in the Accounts menu / status bar). See `Gnn` in
// workbench.web.main.internal.js — setup UI returns "hidden" only when both
// are true.
const configDefaults = {
  "chat.disableAIFeatures": true,
  "workbench.disableAICustomizations": true,
  "chat.commandCenter.enabled": false,
  "chat.agent.enabled": false,
  // MCP (Model Context Protocol) — disable the server runtime, gallery, and
  // discovery so VS Code doesn't scan Claude Desktop / Cursor configs or
  // expose the "Add MCP Server" / gallery UI even if chat were re-enabled.
  "chat.mcp.enabled": false,
  "chat.mcp.discovery.enabled": false,
  "chat.mcp.gallery.enabled": false,
  "chat.mcp.autostart": "never",
  "chat.mcp.access": "none",
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.preferredDarkColorTheme": "Default Dark Modern",
  "workbench.preferredLightColorTheme": "Default Light Modern",
  "window.autoDetectColorScheme": true,
  "workbench.startupEditor": "none",
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  // File watcher exclusions. The bundled VS Code only excludes git/hg metadata
  // by default (no node_modules), so each window's recursive watcher indexes
  // heavy dirs into a multi-GB JS-heap tree. `files.watcherExclude` is a merged
  // object setting, so these are additive — user-added watches still fire.
  "files.watcherExclude": {
    "**/.git/objects/**": true,
    "**/.git/subtree-cache/**": true,
    "**/node_modules/**": true,
    "**/dist/**": true,
    "**/.cache/**": true,
  },
  "search.followSymlinks": false,
  // Bound the bundled tsserver heap. Default ceiling is 3072 MB per instance,
  // and idle instances outlive their window (backend-scoped), so several can
  // accumulate on a shared box. Lower the cap to limit worst-case residency.
  "typescript.tsserver.maxTsServerMemory": 2048,
};

const serverMainPath = `${patchDir}/lib/vscode/out/server-main.js`;
let serverMain = readFileSync(serverMainPath, "utf8");
const uPrefix = "let U={remoteAuthority:p,serverBasePath:a,";
if (!serverMain.includes(uPrefix)) {
  console.error("Cannot patch server-main.js — workbench config object pattern not found");
  process.exit(1);
}
serverMain = serverMain.replace(
  uPrefix,
  `let U={configurationDefaults:${JSON.stringify(configDefaults)},${uPrefix.slice("let U={".length)}`,
);
writeFileSync(serverMainPath, serverMain);
console.log("Patched server-main.js (configurationDefaults injected into workbench options)");

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
