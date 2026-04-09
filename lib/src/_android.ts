// Android/Termux patches — must run before any ESM `import "os"` creates a cached wrapper.

import { fileURLToPath } from "node:url";

// We check the original platform value before overriding it.
if (process.platform === "android") {
  // Termux reports process.platform as "android" which VS Code doesn't handle.
  Object.defineProperty(process, "platform", { value: "linux" });

  // Ensure process.execPath points to the real node binary (not linker64).
  // The main process usually has termux-exec via LD_PRELOAD, but check anyway.
  if (process.execPath.includes("linker64") || process.execPath.startsWith("/apex/")) {
    const resolved =
      process.env.TERMUX_EXEC__PROC_SELF_EXE || "/data/data/com.termux/files/usr/bin/node";
    Object.defineProperty(process, "execPath", {
      value: resolved,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  // Inject a CJS preload into child processes via NODE_OPTIONS. This fixes two
  // issues in forked processes (extension host, tsserver, etc.):
  //   1. process.platform must be "linux" (same as the main process)
  //   2. process.execPath must point to the real node binary, not the Android
  //      linker — VS Code strips LD_PRELOAD so termux-exec can't intercept
  //      /proc/self/exe, causing child_process.fork() to exec linker64.
  // Using --require (CJS) avoids ESM loader conflicts with VS Code's custom
  // module.register() hooks.
  const preload = `--require "${fileURLToPath(import.meta.resolve("#android-preload"))}"`;
  process.env.NODE_OPTIONS = process.env.NODE_OPTIONS
    ? `${process.env.NODE_OPTIONS} ${preload}`
    : preload;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _fs: typeof import("node:fs") = process.getBuiltinModule?.("fs") ?? require("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { syncBuiltinESMExports: _syncESM } =
    process.getBuiltinModule?.("module") ?? require("node:module");

  // Monkey-patch child_process.fork/spawn to re-inject LD_PRELOAD with termux-exec.
  // VS Code's bundled code explicitly `delete env.LD_PRELOAD` before spawning
  // children (and uses `import{fork as tf}from"child_process"` directly).
  // Without termux-exec, Android's W^X policy blocks execve() on binaries in
  // the app data directory (EACCES). The patch ensures every child (including
  // the extension host) gets termux-exec loaded, which in turn lets those
  // children spawn their own children (tsserver, etc.).
  const TERMUX_EXEC_LIB = "/data/data/com.termux/files/usr/lib/libtermux-exec.so";
  try {
    _fs.accessSync(TERMUX_EXEC_LIB);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const _cp: typeof import("node:child_process") =
      process.getBuiltinModule?.("child_process") ?? require("node:child_process");

    const _injectLdPreload = (opts: Record<string, unknown> | undefined) => {
      if (opts && typeof opts === "object" && opts.env) {
        const env = opts.env as Record<string, string | undefined>;
        if (!env.LD_PRELOAD) {
          env.LD_PRELOAD = TERMUX_EXEC_LIB;
        }
      }
    };

    const _spawn = _cp.spawn;
    _cp.spawn = function spawn(
      this: typeof _cp,
      ...spawnArgs: Parameters<typeof _cp.spawn>
    ) {
      _injectLdPreload(spawnArgs[2] as Record<string, unknown>);
      return _spawn.apply(this, spawnArgs);
    } as typeof _cp.spawn;

    const _fork = _cp.fork;
    _cp.fork = function fork(
      this: typeof _cp,
      modulePath: string,
      ...rest: unknown[]
    ) {
      // fork(modulePath, args?, options?) — options can be 2nd or 3rd arg
      for (const arg of rest) {
        if (arg && typeof arg === "object" && !Array.isArray(arg)) {
          _injectLdPreload(arg as Record<string, unknown>);
          break;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (_fork as any).call(this, modulePath, ...rest);
    } as typeof _cp.fork;

    // Sync CJS patches into the ESM namespace so `import{fork}from"child_process"` sees them
    _syncESM();
  } catch {}

  // Filter PATH to remove directories that are inaccessible on Android/Termux.
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
  _syncESM();
}
