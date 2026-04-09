// Minimal @vscode/fs-copyfile shim — drops the macOS-only native APFS clone
// addon and falls back to Node's built-in fs.copyFile / fs.cp.
//
// The upstream package is a drop-in replacement for fs.copyFile that, on
// macOS, uses fclonefileat(2) for copy-on-write. On Linux/Windows it already
// just re-exports the Node built-ins, so shimming it out loses nothing there
// and only gives up the CoW fast-path on macOS (still correct, just slower).

const { copyFile, cp } = require("node:fs/promises");
const { copyFileSync, constants: nodeConstants } = require("node:fs");

module.exports = {
  copyFile,
  copyFileSync,
  cp,
  isMacOS: process.platform === "darwin",
  isCloneSupported: (_path) => false,
  constants: {
    COPYFILE_EXCL: nodeConstants.COPYFILE_EXCL,
    COPYFILE_FICLONE: nodeConstants.COPYFILE_FICLONE,
    COPYFILE_FICLONE_FORCE: nodeConstants.COPYFILE_FICLONE_FORCE,
  },
};
