// Minimal fsevents shim — replaces the macOS-only native FSEvents binding
// with a no-op stub. Consumers (chokidar, @parcel/watcher) already fall back
// to fs.watch/polling when fsevents is unavailable, so this just prevents
// import errors on non-macOS platforms or when the native binary is missing.

function watch(_path, _handler) {
  // Return a stop function that resolves immediately
  return () => Promise.resolve();
}

function getInfo(_path, flags) {
  return {
    event: "unknown",
    path: _path,
    type: "file",
    changes: { inode: false, finder: false, access: false, xattrs: false },
    flags: flags || 0,
  };
}

const constants = {
  None: 0x00000000,
  MustScanSubDirs: 0x00000001,
  UserDropped: 0x00000002,
  KernelDropped: 0x00000004,
  EventIdsWrapped: 0x00000008,
  HistoryDone: 0x00000010,
  RootChanged: 0x00000020,
  Mount: 0x00000040,
  Unmount: 0x00000080,
  ItemCreated: 0x00000100,
  ItemRemoved: 0x00000200,
  ItemInodeMetaMod: 0x00000400,
  ItemRenamed: 0x00000800,
  ItemModified: 0x00001000,
  ItemFinderInfoMod: 0x00002000,
  ItemChangeOwner: 0x00004000,
  ItemXattrMod: 0x00008000,
  ItemIsFile: 0x00010000,
  ItemIsDir: 0x00020000,
  ItemIsSymlink: 0x00040000,
  ItemIsHardlink: 0x00100000,
  ItemIsLastHardlink: 0x00200000,
  OwnEvent: 0x00080000,
  ItemCloned: 0x00400000,
};

module.exports = { watch, getInfo, constants };
