// Mock vsda WASM browser module
define([], function () {
  const vsda = {
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
  globalThis.vsda_web = vsda;
  return vsda;
});
