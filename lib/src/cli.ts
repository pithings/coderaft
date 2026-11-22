#!/usr/bin/env node

import { fork, exec } from "node:child_process";
import type { VSCodeServerOptions } from "./types.ts";
import { BANNER } from "./_banner.ts";

if (process.argv.includes("--worker")) {
  startWorker();
} else {
  startMain();
}

function startWorker() {
  process.on("message", async (msg: { type: string; opts?: any }) => {
    if (msg.type === "start") {
      const { startCodeServer } = await import("./server.ts");
      const handle = await startCodeServer(msg.opts);
      process.send!({
        type: "ready",
        url: handle.url,
        connectionToken: handle.connectionToken,
        port: handle.port,
        socketPath: handle.socketPath,
      });
    }
  });
}

async function startMain() {
  const { parseArgs } = await import("node:util");
  const { cliOptions, vsKeys, helpText } = await import("./_args.ts");

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: cliOptions,
    strict: true,
  });

  if (values.help) {
    console.log(helpText);
    process.exit(0);
  }

  // Build VSCodeServerOptions from parsed args, omitting undefined values
  const vscode: VSCodeServerOptions = {};
  for (const key of vsKeys) {
    if (values[key] !== undefined) {
      (vscode as Record<string, unknown>)[key] = values[key];
    }
  }
  if (values["logs-path"]) {
    vscode.logsPath = values["logs-path"];
  }

  // Extension management mirrors the `code` / `code-server` CLI: these commands
  // run against the extensions directory and exit rather than booting a server,
  // so tooling that shells out to `code --force --install-extension <id>` and
  // waits for it (IDE extension installers, provisioning scripts) works.
  // `--preinstall-extension` is the flag for installing *and then* serving.
  const install = values["install-extension"];
  const uninstall = values["uninstall-extension"];
  if (install?.length || uninstall?.length || values["list-extensions"]) {
    const { resolveExtensionDirs, runExtensionCommand } = await import("./extensions.ts");
    process.exit(
      await runExtensionCommand(
        {
          install,
          uninstall,
          list: values["list-extensions"],
          showVersions: values["show-versions"],
          force: values.force,
          preRelease: values["pre-release"],
        },
        resolveExtensionDirs(vscode),
      ),
    );
  }

  const dir = positionals[0];
  if (dir) {
    vscode["disable-workspace-trust"] = true;
  }

  const opts = {
    port: values.port ? Number(values.port) : undefined,
    host: values.host,
    socketPath: values["socket-path"],
    baseURL: values["base-url"] ?? values["server-base-path"],
    proxyURI: values["proxy-uri"],
    defaultFolder: dir || values["default-folder"],
    connectionToken: values["connection-token"] ?? values.token,
    extensions: values["preinstall-extension"],
    vscode,
  };

  // Print the banner up front so server startup logs follow it.
  console.log(`\n${BANNER}`);

  if (values["no-fork"]) {
    // Run server directly in the main process
    const { startCodeServer } = await import("./server.ts");

    let handle: Awaited<ReturnType<typeof startCodeServer>> | undefined;
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) {
        process.exit(0);
      }
      shuttingDown = true;
      setTimeout(() => process.exit(0), 3000).unref();
      if (handle) {
        handle.close().finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    handle = await startCodeServer(opts);
    onReady(handle.url);
  } else {
    // Fork worker subprocess (re-exec self with --worker)
    const child = fork(process.argv[1]!, ["--worker"], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });

    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) {
        process.exit(0);
      }
      shuttingDown = true;
      child.kill("SIGTERM");
      setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    child.on("exit", (code) => {
      process.exit(code ?? 1);
    });

    child.send({ type: "start", opts });

    child.on("message", (msg: { type: string; url?: string; rss?: number }) => {
      if (msg.type === "ready") {
        onReady(msg.url!);
      }
    });
  }

  function onReady(url: string) {
    if (values.open) {
      openBrowser(url);
    }

    const c = {
      cyan: "\x1b[36m",
      bold: "\x1b[1m",
      dim: "\x1b[2m",
      reset: "\x1b[0m",
    };
    const rss = process.memoryUsage.rss();
    const mem = `${(rss / 1024 / 1024).toFixed(0)} MB`;
    console.log(
      `\n  ${c.bold}${c.cyan}➜${c.reset}  ${c.bold}Ready${c.reset} ${c.dim}at${c.reset} ${c.cyan}${url}${c.reset}` +
        `\n  ${c.bold}${c.cyan}➜${c.reset}  ${c.bold}Memory${c.reset} ${c.dim}${mem}${c.reset}\n`,
    );
  }
}

function openBrowser(url: string) {
  const platform = process.platform;
  if (platform === "darwin") {
    exec(
      `open -na "Google Chrome" --args --app="${url}" || open -na "Chromium" --args --app="${url}" || open "${url}"`,
    );
  } else if (platform === "win32") {
    exec(`start chrome --app="${url}" || start msedge --app="${url}" || start "" "${url}"`);
  } else {
    exec(
      `google-chrome-stable --app="${url}" 2>/dev/null || google-chrome --app="${url}" 2>/dev/null || chromium --app="${url}" 2>/dev/null || xdg-open "${url}"`,
    );
  }
}
