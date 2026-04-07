import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

function getDirectory() {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("Home directory not found");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Microsoft", "DeveloperTools");
  }
  const cache = process.env.XDG_CACHE_HOME ?? join(home, ".cache");
  return join(cache, "Microsoft", "DeveloperTools");
}

export async function getDeviceId() {
  const filePath = join(getDirectory(), "deviceid");
  try {
    return await readFile(filePath, "utf8");
  } catch {
    // File doesn't exist or can't be read — generate a new ID
  }
  const deviceId = randomUUID().toLowerCase();
  const dir = getDirectory();
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, deviceId, "utf8");
  return deviceId;
}
