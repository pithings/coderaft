// https://patorjk.com/software/taag/#p=testall&f=Graffiti&t=Coderaft&x=none&v=4&h=4&w=80&we=false

const BANNER_PLAIN = `
▄█████  ▄▄▄  ▄▄▄▄  ▄▄▄▄▄ ▄▄▄▄   ▄▄▄  ▄▄▄▄▄ ▄▄▄▄▄▄
██     ██▀██ ██▀██ ██▄▄  ██▄█▄ ██▀██ ██▄▄    ██
▀█████ ▀███▀ ████▀ ██▄▄▄ ██ ██ ██▀██ ██      ██
  `;

function gradientBanner(text: string): string {
  // Cyan → Blue → Magenta gradient
  const colors = [
    [0, 210, 255], // cyan
    [0, 150, 255], // blue
    [120, 80, 255], // indigo
    [200, 50, 255], // magenta
  ] as const;

  const lines = text.split("\n");
  return lines
    .map((line) => {
      if (line.trim().length === 0) return line;
      let result = "";
      for (let i = 0; i < line.length; i++) {
        const t = line.length > 1 ? i / (line.length - 1) : 0;
        const segment = t * (colors.length - 1);
        const idx = Math.min(Math.floor(segment), colors.length - 2);
        const local = segment - idx;
        const c0 = colors[idx]!;
        const c1 = colors[idx + 1]!;
        const r = Math.round(c0[0] + (c1[0] - c0[0]) * local);
        const g = Math.round(c0[1] + (c1[1] - c0[1]) * local);
        const b = Math.round(c0[2] + (c1[2] - c0[2]) * local);
        result += `\x1b[38;2;${r};${g};${b}m${line[i]}`;
      }
      return result + "\x1b[0m";
    })
    .join("\n");
}

export const BANNER = gradientBanner(BANNER_PLAIN);

export const BANNER_LINES = BANNER.split("\n").length;

export interface TUIStats {
  rss: number;
}

export function createTUI(HEADER_LINES: number, opts?: { onOpen?: () => void }) {
  const c = {
    cyan: "\x1b[36m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    reset: "\x1b[0m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
  };

  const logBuffer: string[] = [];
  const maxBuffer = 5000;
  let scrollOffset = 0; // 0 = pinned to bottom
  let url = "";
  let rendering = false;
  let stats: TUIStats = { rss: 0 };
  let startedAt = 0;

  // Intercept console output
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const write = (s: string) => origStdoutWrite(s);
  const origConsoleLog = console.log;
  const origConsoleError = console.error;
  const origConsoleWarn = console.warn;

  // Enter alt screen
  write("\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l"); // alt screen + clear + hide cursor
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    // Restore original stdout/console before leaving alt screen
    process.stdout.write = origStdoutWrite;
    console.log = origConsoleLog;
    console.error = origConsoleError;
    console.warn = origConsoleWarn;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    write("\x1b[?25h\x1b[?1049l"); // show cursor + leave alt screen

    // Print summary to normal screen
    const lines: string[] = [BANNER, ""];
    if (url) {
      let status = `  ${c.bold}\x1b[31m●${c.reset}  ${c.cyan}${url}${c.reset}`;
      const rss = stats.rss || 0;
      if (rss > 0) {
        status += `  ${c.dim}▪ mem ${(rss / 1024 / 1024).toFixed(0)} MB${c.reset}`;
      }
      if (startedAt) {
        status += `  ${c.dim}▴ up ${formatUptime(Date.now() - startedAt)}${c.reset}`;
      }
      lines.push(status);
    }
    if (lines.length > 0) {
      write(`\n${lines.join("\n")}\n\n`);
    }
  };

  const addLines = (text: string) => {
    const lines = text.split("\n");
    const added = lines.length;
    for (const line of lines) {
      logBuffer.push(line);
    }
    while (logBuffer.length > maxBuffer) logBuffer.shift();
    if (scrollOffset > 0) {
      // Keep viewport on the same content when scrolled up
      const logRows = (process.stdout.rows || 24) - HEADER_LINES;
      const maxOffset = Math.max(0, logBuffer.length - logRows);
      scrollOffset = Math.min(maxOffset, scrollOffset + added);
    }
    scheduleRender();
  };

  const format = (...args: unknown[]) =>
    args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");

  console.log = (...args: unknown[]) => addLines(format(...args));
  console.error = (...args: unknown[]) => addLines(format(...args));
  console.warn = (...args: unknown[]) => addLines(`${c.yellow}${format(...args)}${c.reset}`);

  process.stdout.write = ((chunk: any, ...rest: any[]) => {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    if (rendering) return origStdoutWrite(chunk, ...rest);
    addLines(str.replace(/\n$/, ""));
    return true;
  }) as typeof process.stdout.write;

  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      render();
    }, 16);
  }

  function render() {
    rendering = true;
    const rows = process.stdout.rows || 24;
    const cols = process.stdout.columns || 80;
    const logRows = rows - HEADER_LINES;
    if (logRows <= 0) {
      rendering = false;
      return;
    }

    const total = logBuffer.length;
    const end = total - scrollOffset;
    const start = Math.max(0, end - logRows);
    const visible = logBuffer.slice(start, end);

    let out = "\x1b[H"; // cursor home

    // Header
    const rss = stats.rss || process.memoryUsage.rss();
    const mem = `${(rss / 1024 / 1024).toFixed(0)} MB`;
    const sep = c.dim + "─".repeat(cols) + c.reset;

    for (const line of BANNER.split("\n")) {
      out += `\x1b[2K${line}\n`;
    }
    out += `\x1b[2K\n`;

    if (url) {
      let status = `  ${c.bold}\x1b[32m●${c.reset}  ${c.cyan}${url}${c.reset}`;
      status += `  ${c.dim}▪ mem ${mem}${c.reset}`;
      if (startedAt) {
        status += `  ${c.dim}▴ up ${formatUptime(Date.now() - startedAt)}${c.reset}`;
      }
      if (scrollOffset > 0) {
        status += `  ${c.yellow}↑ ${scrollOffset}${c.reset}`;
      }
      out += `\x1b[2K${status}\n`;
      if (opts?.onOpen) {
        out += `\x1b[2K  ${c.dim}press ${c.reset}${c.bold}enter${c.reset}${c.dim} to open  ${c.reset}${c.bold}q${c.reset}${c.dim} to quit${c.reset}\n`;
      }
    } else {
      out += `\x1b[2K  ${c.dim}○  Starting...${c.reset}\n`;
    }

    out += `\x1b[2K${sep}\n`;

    // Log lines
    for (let i = 0; i < logRows; i++) {
      out += `\x1b[2K${visible[i] ?? ""}\n`;
    }

    write(out);
    rendering = false;
  }

  // Keyboard input for scrolling
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (data: Buffer) => {
      const key = data.toString();
      const logRows = (process.stdout.rows || 24) - HEADER_LINES;
      const maxOffset = Math.max(0, logBuffer.length - logRows);

      if (key === "\x1b[A" || key === "k") {
        // Up arrow / k
        scrollOffset = Math.min(maxOffset, scrollOffset + 1);
        render();
      } else if (key === "\x1b[B" || key === "j") {
        // Down arrow / j
        scrollOffset = Math.max(0, scrollOffset - 1);
        render();
      } else if (key === "\x1b[5~") {
        // Page Up
        scrollOffset = Math.min(maxOffset, scrollOffset + logRows);
        render();
      } else if (key === "\x1b[6~") {
        // Page Down
        scrollOffset = Math.max(0, scrollOffset - logRows);
        render();
      } else if (key === "g") {
        // Top
        scrollOffset = maxOffset;
        render();
      } else if (key === "G") {
        // Bottom
        scrollOffset = 0;
        render();
      } else if (key === "\r" && url && opts?.onOpen) {
        // Enter — open in browser
        opts.onOpen();
      } else if (key === "q" || key === "\x03") {
        // q / Ctrl+C — quit
        process.kill(process.pid, "SIGINT");
      }
    });
  }

  process.stdout.on("resize", () => render());

  render();

  let refreshInterval: ReturnType<typeof setInterval> | undefined;

  return {
    setURL(u: string) {
      url = u;
      startedAt = Date.now();
      render();
      // Refresh banner every 2s for live stats
      refreshInterval = setInterval(() => scheduleRender(), 2000);
      refreshInterval.unref();
    },
    setStats(s: TUIStats) {
      stats = s;
    },
    destroy() {
      if (refreshInterval) clearInterval(refreshInterval);
      destroy();
    },
  };
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
