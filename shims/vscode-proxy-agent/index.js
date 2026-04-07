// Shim for @vscode/proxy-agent
// Passes through Node.js native http/https/net/tls without proxy interception.
// Drops the heavy dependency tree (undici, socks-proxy-agent, http-proxy-agent, etc.).
// Users behind a proxy can set HTTP_PROXY/HTTPS_PROXY env vars which Node.js respects natively.

export const LogLevel = {
  Trace: 0,
  Debug: 1,
  Info: 2,
  Warning: 3,
  Error: 4,
  Critical: 5,
  Off: 6,
};

export function createProxyResolver(_params) {
  return {
    resolveProxyWithRequest(_flags, _req, _opts, _url, callback) {
      callback(undefined);
    },
    resolveProxyURL(_url) {
      return Promise.resolve(undefined);
    },
  };
}

export function createHttpPatch(_params, originals, _resolveProxy) {
  return {
    get: originals.get,
    request: originals.request,
  };
}

export function createNetPatch(_params, originals) {
  return {
    connect: originals.connect,
  };
}

export function createTlsPatch(_params, originals) {
  return {
    connect: originals.connect,
    createSecureContext: originals.createSecureContext,
  };
}

export function createFetchPatch(_params, originalFetch, _resolveProxyURL) {
  return originalFetch;
}

export function createWebSocketPatch(_params, originalWebSocket, _resolveProxyURL) {
  return originalWebSocket;
}

export function setProxyAuthorizationHeader(_options, _proxyAuthorization) {}

export function patchUndici(_originalUndici) {}

export function getOrLoadAdditionalCertificates(_params) {
  return Promise.resolve([]);
}

export function loadSystemCertificates(_params) {
  return Promise.resolve([]);
}

export function resetCaches() {}

export function toLogString(args) {
  return args.map(String).join(" ");
}

export const testCertificates = [];

// VS Code does `I = mod.default || mod; I.resolveProxyURL = f;`
// ESM namespace objects are non-extensible, so we provide a mutable default export.
export default {
  LogLevel,
  createProxyResolver,
  createHttpPatch,
  createNetPatch,
  createTlsPatch,
  createFetchPatch,
  createWebSocketPatch,
  setProxyAuthorizationHeader,
  patchUndici,
  getOrLoadAdditionalCertificates,
  loadSystemCertificates,
  resetCaches,
  toLogString,
  testCertificates,
};
