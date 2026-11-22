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
