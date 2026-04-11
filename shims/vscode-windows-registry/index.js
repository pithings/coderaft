// JS shim for `@vscode/windows-registry` (native C++ addon with unbuilt node-gyp sources).
// Used only by VS Code's telemetry/machine-id code on Windows, e.g.
//   `GetStringRegKey("HKEY_LOCAL_MACHINE", ..., "MachineId")`.
// The real addon has no prebuilt binary, so calls would crash with
// "Cannot find module '../build/Release/winregistry.node'". Every call site
// in VS Code already handles errors / empty returns, so we throw from each
// entry point — callers fall back to their own defaults.

function unavailable() {
  throw new Error("@vscode/windows-registry native addon is not available in coderaft");
}

exports.GetStringRegKey = unavailable;
exports.GetDWORDRegKey = unavailable;
