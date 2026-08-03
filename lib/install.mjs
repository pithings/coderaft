// Forked child entry used to drive extension management through VS Code's own
// CLI (`spawnCli`) — install, uninstall, and list. This runs in a dedicated
// process because `spawnCli` calls `process.exit()` once the command settles —
// doing it in-process would tear down the parent's long-lived server. Config is
// passed via the `CODERAFT_INSTALL` env var (JSON); progress is logged to
// stdout/stderr by VS Code itself.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCode } from "#code";

const cfg = JSON.parse(process.env.CODERAFT_INSTALL || "{}");

// Suppress server-main.js's standalone auto-boot (same trick as server.ts):
// the module top-level is `process.env.CODE_SERVER_PARENT_PID || <boot>()`, so
// a truthy value makes the import side-effect-free and lets us drive the CLI.
process.env.CODE_SERVER_PARENT_PID ??= String(process.pid);

const { modulesDir } = await loadCode();
const vsRoot = join(modulesDir, "code-server", "lib", "vscode");
const mod = await import(pathToFileURL(join(vsRoot, "out/server-main.js")).href);
const serverModule = await mod.loadCodeWithNls();

// The uninstall path compares every candidate against
// `productService.defaultChatAgent.extensionId` to keep the built-in chat agent
// from being removed. code-server's product.json has no `defaultChatAgent`, so
// the comparison throws before anything is uninstalled. An empty id is a valid
// operand that no real extension id can equal.
const _product = globalThis._VSCODE_PRODUCT_JSON;
if (_product) {
  _product.defaultChatAgent ??= { extensionId: "" };
}

// `spawnCli` consumes a VS Code NativeParsedArgs object. Extensions resolve
// against the gallery baked into the patched server-main.js, which defaults to
// Open VSX (https://open-vsx.org/vscode/gallery).
await serverModule.spawnCli({
  _: [],
  ...(cfg.ids?.length ? { "install-extension": cfg.ids } : {}),
  ...(cfg.uninstall?.length ? { "uninstall-extension": cfg.uninstall } : {}),
  ...(cfg.list ? { "list-extensions": true } : {}),
  ...(cfg.showVersions ? { "show-versions": true } : {}),
  "extensions-dir": cfg.extensionsDir,
  "user-data-dir": cfg.userDataDir,
  "server-data-dir": cfg.serverDataDir,
  ...(cfg.force ? { force: true } : {}),
  ...(cfg.preRelease ? { "pre-release": true } : {}),
});
