#!/usr/bin/env node

import { fork, exec } from "node:child_process";
import type { VSCodeServerOptions } from "./types.ts";
import { createTUI, BANNER, BANNER_LINES } from "./_tui.ts";

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

  const dir = positionals[0];
  if (dir) {
    vscode["disable-workspace-trust"] = true;
  }

  const opts = {
    port: values.port ? Number(values.port) : undefined,
    host: values.host,
    socketPath: values["socket-path"],
    baseURL: values["base-url"] ?? values["server-base-path"],
    defaultFolder: dir || values["default-folder"],
    connectionToken: values["connection-token"] ?? values.token,
    vscode,
  };

  const interactive = process.stdout.isTTY && !values["no-tui"];
  const HEADER_LINES = BANNER_LINES + 4; // banner + blank + status + hints + separator

  // Enter alt screen early so startup logs are captured
  let tui: ReturnType<typeof createTUI> | undefined;
  let serverURL = "";
  if (interactive) {
    tui = createTUI(HEADER_LINES, {
      onOpen: () => {
        if (serverURL) openBrowser(serverURL);
      },
    });
  }

  // Ensure alt screen is left on any exit path
  process.on("exit", () => tui?.destroy());

  if (values["no-fork"]) {
    // Run server directly in the main process
    const { startCodeServer } = await import("./server.ts");

    let handle: Awaited<ReturnType<typeof startCodeServer>> | undefined;
    let shuttingDown = false;
    const shutdown = () => {
      tui?.destroy();
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
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...process.env, FORCE_COLOR: "1" },
    });

    // Pipe child output through the TUI (or straight to parent stdout/stderr)
    // With "pipe" stdio, child output must be forwarded manually.
    // When TUI is active, process.stdout.write is overridden to capture into the log buffer.
    child.stdout!.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr!.on("data", (chunk: Buffer) => console.error(chunk.toString()));

    let shuttingDown = false;
    const shutdown = () => {
      tui?.destroy();
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
    serverURL = url;

    if (values.open) {
      openBrowser(url);
    }

    if (tui) {
      tui.setURL(url);
      return;
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
      `\n${BANNER}\n` +
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
