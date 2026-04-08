#!/usr/bin/env node
/**
 * Deploy and run coderaft on a real Android device via adb + Termux.
 *
 * Prerequisites:
 *   - adb connected device (`adb devices`)
 *   - Termux installed on the device (F-Droid version recommended)
 *   - In Termux, run: `pkg install nodejs-lts` (once)
 *   - Allow Termux storage access: `termux-setup-storage` (once)
 *
 * What it does:
 *   1. Pushes lib/ to /sdcard/coderaft/ via adb
 *   2. Sends a Termux RUN_COMMAND intent to run coderaft
 *   3. Sets up adb port forwarding so you can access it from the host
 *
 * Usage:
 *   node scripts/android.ts [--port 6063] [--push-only]
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";

const rootDir = join(import.meta.dirname!, "..");
const libDir = join(rootDir, "lib");

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "6063" },
    serial: { type: "string" },
  },
});

const port = values.port!;
const serial = values.serial;

const adb = serial ? `adb -s ${serial}` : "adb";
const deviceDir = "/sdcard/coderaft";

function run(cmd: string, opts?: { stdio?: "inherit" | "pipe" }) {
  return execSync(cmd, { stdio: opts?.stdio ?? "inherit", cwd: rootDir });
}

// -- Check device --

console.log("Checking device...");
const devices = run(`${adb} devices`, { stdio: "pipe" }).toString();
if (!devices.includes("\tdevice")) {
  console.error("No device found. Check `adb devices`.");
  process.exit(1);
}

// -- Push lib/ to device --

console.log(`\nPushing lib/ to ${deviceDir}...`);
run(`${adb} shell rm -rf ${deviceDir}`);
run(`${adb} shell mkdir -p ${deviceDir}`);
for (const file of ["src", "dist", "code.mjs", "tar.mjs", "code.tar.zst", "package.json"]) {
  run(`${adb} push ${libDir}/${file} ${deviceDir}/${file}`);
}
console.log("Done.\n");

// -- Port forward --

console.log(`Forwarding localhost:${port} → device:${port}`);
run(`${adb} forward tcp:${port} tcp:${port}`);

const termuxCmd = `cd ${deviceDir} && node dist/cli.mjs --host 0.0.0.0 --port ${port} --without-connection-token`;

console.log(`\nRun this in Termux on the device:\n`);
console.log(`  ${termuxCmd}\n`);
console.log(`Then open: http://localhost:${port}`);
console.log(`Press Ctrl+C to remove port forwarding.\n`);

// Keep alive until Ctrl+C
process.on("SIGINT", () => {
  console.log("\nRemoving port forward...");
  try {
    run(`${adb} forward --remove tcp:${port}`, { stdio: "pipe" });
  } catch {}
  process.exit(0);
});

setInterval(() => {}, 60_000);
