// Mock vsda WASM browser module
// VS Code expects a global `vsda_web` after loading this script.
globalThis.vsda_web = {
  default: async function (_bytes) {},
  sign(value) {
    return value;
  },
  validator: class {
    createNewMessage(_msg) {
      return "ok";
    }
    validate(_value) {
      return "ok";
    }
    free() {}
  },
};
