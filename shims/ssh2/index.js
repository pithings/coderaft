// Shim for `ssh2` — listed as a direct dependency by upstream code-server but
// not actually required by the bundled VS Code server, CLI, bootstrap-fork, or
// any extension. The only "ssh2" references in the build output are embedded
// copies of code-server's package.json `overrides` block.
//
// Replacing it with this stub avoids shipping ssh2 + its native transitive
// deps (`cpu-features`, `nan`, `asn1`, `bcrypt-pbkdf`, `tweetnacl`, …) which
// add ~2 MB of unused weight and several MB of native build artifacts.
//
// If a future code-server bump starts loading ssh2 for real, callers will
// surface a clear error from the proxy attempting to instantiate it.

const UNSUPPORTED = "ssh2 is not bundled in coderaft";

function unsupported() {
  throw new Error(UNSUPPORTED);
}

class Client {
  constructor() {
    unsupported();
  }
}

class Server {
  constructor() {
    unsupported();
  }
}

module.exports = {
  Client,
  Server,
  utils: {
    parseKey: unsupported,
    generateKeyPair: unsupported,
    generateKeyPairSync: unsupported,
  },
};
