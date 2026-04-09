const { randomUUID } = require("node:crypto");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { join } = require("node:path");

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

async function getDeviceId() {
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

module.exports = { getDeviceId };
