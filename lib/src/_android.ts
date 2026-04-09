// Android/Termux patches — must run before any ESM `import "os"` creates a cached wrapper.
// We check the original platform value before overriding it.
if (process.platform === "android") {
  // Termux reports process.platform as "android" which VS Code doesn't handle.
  Object.defineProperty(process, "platform", { value: "linux" });
  const preload = `--import "data:text/javascript,Object.defineProperty(process,'platform',{value:'linux'})"`;
  process.env.NODE_OPTIONS = process.env.NODE_OPTIONS
    ? `${process.env.NODE_OPTIONS} ${preload}`
    : preload;

  // Filter PATH to remove directories that are inaccessible on Android/Termux.
  // VS Code's node.js file watcher tries to watch every PATH dir for executable
  // changes. System dirs like /system/bin, /vendor/bin are read-only and produce
  // noisy EACCES errors. They never change at runtime so safe to exclude.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _fs: typeof import("node:fs") = process.getBuiltinModule?.("fs") ?? require("node:fs");
  if (process.env.PATH) {
    const accessible = process.env.PATH.split(":").filter((dir) => {
      try {
        _fs.accessSync(dir, _fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    });
    if (accessible.length > 0) {
      process.env.PATH = accessible.join(":");
    }
  }

  // Ensure `os.networkInterfaces()` always returns at least one interface with a
  // valid MAC. On Termux/Android no real NICs are exposed, causing VS Code's
  // `getMacAddress()` to throw "Unable to retrieve mac address (unexpected format)".
  // We patch the CJS exports and call `syncBuiltinESMExports()` to propagate the
  // change into the ESM wrapper, so `import { networkInterfaces } from "os"` sees it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _os: typeof import("node:os") = process.getBuiltinModule?.("os") ?? require("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _crypto: typeof import("node:crypto") =
    process.getBuiltinModule?.("crypto") ?? require("node:crypto");
  const BLACKLISTED = new Set(["00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "ac:de:48:00:11:22"]);
  const original = _os.networkInterfaces;
  _os.networkInterfaces = function networkInterfaces() {
    const ifaces = original.call(_os);
    for (const name in ifaces) {
      for (const info of ifaces[name]!) {
        if (info.mac && !BLACKLISTED.has(info.mac)) return ifaces;
      }
    }
    // No valid MAC found — inject a deterministic one derived from hostname
    const hash = _crypto.createHash("md5").update(_os.hostname()).digest();
    // Format as a locally-administered unicast MAC (set bit 1 of first octet)
    hash[0] = (hash[0]! | 0x02) & 0xfe;
    const mac = [...hash.subarray(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join(":");
    ifaces._coderaft = [
      {
        address: "10.0.0.1",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac,
        internal: false,
        cidr: "10.0.0.1/24",
      },
    ];
    return ifaces;
  } as typeof _os.networkInterfaces;
  // Flush CJS mutation into the ESM wrapper so `import { networkInterfaces } from "os"`
  // in VS Code's bundle sees our patched function.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { syncBuiltinESMExports } = process.getBuiltinModule?.("module") ?? require("node:module");
  syncBuiltinESMExports();
}
