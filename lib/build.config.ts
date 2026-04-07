import { execSync } from "node:child_process";
import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: ["./src/index.ts", "./src/cli.ts"],
    },
  ],
  hooks: {
    async start() {
      execSync("node ../scripts/link.ts", { stdio: "inherit", cwd: import.meta.dirname });
      execSync("node ../scripts/pack.ts", { stdio: "inherit", cwd: import.meta.dirname });
    },
  },
});
