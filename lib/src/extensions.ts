// Extension commands can run without ever loading the server (`coderaft
// --install-extension …`), so the Android/Termux patches — which teach forked
// children how to exec — have to be applied from here too. Idempotent: the
// module evaluates once per process.
import "./_android.ts";
import { fork } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { VSCodeServerOptions } from "./types.ts";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _os: typeof import("node:os") = process.getBuiltinModule?.("os") ?? require("node:os");

export interface ExtensionDirs {
  /** VS Code server data directory. */
  serverDataDir: string;
  /** VS Code user data directory. */
  userDataDir: string;
  /** Directory extensions are installed into. */
  extensionsDir: string;
}

/**
 * Resolve the data directories extension management and the running server must
 * agree on, mirroring VS Code's OSS server defaults
 * (`~/.vscode-server-oss/{,data,extensions}`).
 */
export function resolveExtensionDirs(vscode: VSCodeServerOptions = {}): ExtensionDirs {
  const serverDataDir = vscode["server-data-dir"] ?? join(_os.homedir(), ".vscode-server-oss");
  return {
    serverDataDir,
    userDataDir: vscode["user-data-dir"] ?? join(serverDataDir, "data"),
    extensionsDir: vscode["extensions-dir"] ?? join(serverDataDir, "extensions"),
  };
}

export interface EnsureExtensionsOptions {
  /** Directory extensions are installed into (must match the running server). */
  extensionsDir: string;
  /** VS Code user data directory. */
  userDataDir: string;
  /** VS Code server data directory. */
  serverDataDir?: string;
  /** Reinstall even if an extension with the same id is already present. */
  force?: boolean;
  /** Install pre-release versions when available. */
  preRelease?: boolean;
}

interface InstalledEntry {
  identifier?: { id?: string };
}

/**
 * Read the ids of already-installed extensions (lowercased) from the
 * `extensions.json` manifest VS Code maintains in the extensions directory.
 * Returns an empty set when the directory or manifest doesn't exist yet.
 */
export function readInstalledExtensions(extensionsDir: string): Set<string> {
  try {
    const raw = readFileSync(join(extensionsDir, "extensions.json"), "utf8");
    const entries = JSON.parse(raw) as InstalledEntry[];
    return new Set(
      entries
        .map((e) => e.identifier?.id?.toLowerCase())
        .filter((id): id is string => typeof id === "string"),
    );
  } catch {
    return new Set();
  }
}

/** Strip a `@version` / `@pre-release` suffix from an extension spec. */
function specId(spec: string): string {
  // A leading `@` (scoped-style ids don't exist here, but be safe) shouldn't be
  // treated as a version separator.
  const at = spec.indexOf("@", 1);
  return (at === -1 ? spec : spec.slice(0, at)).toLowerCase();
}

/** Returns the specs that still need installing (skips local `.vsix` paths' dedupe). */
function pendingExtensions(specs: string[], extensionsDir: string): string[] {
  const installed = readInstalledExtensions(extensionsDir);
  return specs.filter((spec) => {
    // Local .vsix files are cheap to re-apply and may have changed on disk;
    // always hand them to the CLI (it no-ops if identical).
    if (spec.toLowerCase().endsWith(".vsix")) return true;
    return !installed.has(specId(spec));
  });
}

/**
 * Ensure the given extensions are installed before the server boots. Missing
 * extensions are installed from the gallery (Open VSX by default) in a forked
 * child process — `spawnCli` calls `process.exit()` when done, so it cannot run
 * in the server process. Best-effort: install failures are logged, not thrown,
 * so a bad id or a gallery outage never blocks startup.
 */
export async function ensureExtensions(
  specs: string[],
  opts: EnsureExtensionsOptions,
): Promise<void> {
  const pending = opts.force ? specs : pendingExtensions(specs, opts.extensionsDir);
  if (pending.length === 0) return;

  console.log(
    `[coderaft] Installing ${pending.length} extension${pending.length === 1 ? "" : "s"}: ${pending.join(", ")}`,
  );

  await forkCli({ ids: pending, ...opts });

  // Verify against the manifest and warn about anything that didn't land.
  const installed = readInstalledExtensions(opts.extensionsDir);
  for (const spec of pending) {
    if (spec.toLowerCase().endsWith(".vsix")) continue;
    if (!installed.has(specId(spec))) {
      console.warn(`[coderaft] Extension failed to install: ${spec}`);
    }
  }
}

export interface ExtensionCommand {
  /** Specs to install: gallery id, `id@version`, or a path to a local `.vsix`. */
  install?: string[];
  /** Extension ids to uninstall. */
  uninstall?: string[];
  /** Print the installed extensions to stdout. */
  list?: boolean;
  /** Append `@version` to each id in `list` output. */
  showVersions?: boolean;
  /** Reinstall even if the extension is already present. */
  force?: boolean;
  /** Install pre-release versions when available. */
  preRelease?: boolean;
}

/**
 * Run VS Code's own extension CLI to completion and resolve with the exit code
 * to hand back to the shell. This backs the `code`-compatible one-shot commands
 * (`--install-extension`, `--uninstall-extension`, `--list-extensions`), which
 * manage extensions and exit instead of booting a server.
 *
 * A zero exit from the CLI is verified against the extensions manifest, so a
 * spec that silently didn't land still reports failure to the caller.
 */
export async function runExtensionCommand(
  cmd: ExtensionCommand,
  dirs: ExtensionDirs,
): Promise<number> {
  const code = await forkCli({ ids: cmd.install, ...cmd, ...dirs });
  if (code !== 0 || !cmd.install?.length) return code;

  const installed = readInstalledExtensions(dirs.extensionsDir);
  const failed = cmd.install.filter(
    (spec) => !spec.toLowerCase().endsWith(".vsix") && !installed.has(specId(spec)),
  );
  if (failed.length === 0) return 0;

  console.error(`[coderaft] Extension failed to install: ${failed.join(", ")}`);
  return 1;
}

interface CliConfig extends ExtensionCommand, Partial<ExtensionDirs> {
  /** Specs to install (the name `#install` has read since it only installed). */
  ids?: string[];
}

/**
 * Fork `#install` to drive VS Code's `spawnCli` and resolve with its exit code.
 * A dedicated process is required — `spawnCli` calls `process.exit()` when the
 * command settles, which would tear down a long-lived server.
 */
function forkCli(cfg: CliConfig): Promise<number> {
  const installPath = fileURLToPath(import.meta.resolve("#install"));
  return new Promise((resolve, reject) => {
    const child = fork(installPath, {
      // Pipe stdout so we can drop VS Code's noisy `info [uuid] …` log lines and
      // keep only the human-facing "Installing …" / "successfully installed"
      // messages; surface stderr as-is.
      stdio: ["ignore", "pipe", "inherit", "ipc"],
      env: {
        ...process.env,
        CODERAFT_INSTALL: JSON.stringify({
          ids: cfg.ids,
          uninstall: cfg.uninstall,
          list: cfg.list,
          showVersions: cfg.showVersions,
          extensionsDir: cfg.extensionsDir,
          userDataDir: cfg.userDataDir,
          serverDataDir: cfg.serverDataDir,
          force: cfg.force,
          preRelease: cfg.preRelease,
        }),
      },
    });

    let buf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\s*(info|debug|trace)\s+\[/.test(line)) continue;
        if (line.trim()) console.log(line);
      }
    });

    // Report the exit code rather than throwing on it — `ensureExtensions`
    // ignores it and verifies against the manifest instead, so a bad id never
    // blocks startup. A spawn error (e.g. missing entry file) is a real
    // problem, so reject on that.
    child.once("exit", (code, signal) => {
      if (buf.trim() && !/^\s*(info|debug|trace)\s+\[/.test(buf)) console.log(buf);
      resolve(code ?? (signal ? 1 : 0));
    });
    child.once("error", reject);
  });
}
