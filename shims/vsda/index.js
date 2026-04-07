// Mock vsda — Microsoft's proprietary telemetry signing module.
// Provides no-op validator/signer so VS Code skips signature checks.

class validator {
  createNewMessage(_msg) {
    return "ok";
  }
  validate(_value) {
    return "ok";
  }
  free() {}
}

class signer {
  sign(value) {
    return value;
  }
}

module.exports = { validator, signer };
