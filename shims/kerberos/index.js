// Shim for `kerberos` — replaces the native GSSAPI/SSPI binding used by
// VS Code's built-in proxy authentication (loaded via dynamic `import("kerberos")`
// from `server-main.js` and `extensionHostProcess.js`).
//
// Kerberos-authenticated proxies are not supported in coderaft: `@vscode/proxy-agent`
// is itself a no-op shim, so the proxy auth code path that reaches into kerberos is
// effectively dead. Users behind a proxy should set HTTP_PROXY / HTTPS_PROXY env vars.
//
// The shim throws from `initializeClient` so VS Code's caller surfaces a clear
// error instead of silently producing a malformed Negotiate token.

const UNSUPPORTED = "kerberos proxy authentication is not supported in coderaft";

function unsupported() {
  throw new Error(UNSUPPORTED);
}

exports.initializeClient = unsupported;
exports.initializeServer = unsupported;
exports.principalDetails = unsupported;
exports.checkPassword = unsupported;

// GSS flags / OIDs — kept for API parity with the real `kerberos` package.
exports.GSS_C_DELEG_FLAG = 1;
exports.GSS_C_MUTUAL_FLAG = 2;
exports.GSS_C_REPLAY_FLAG = 4;
exports.GSS_C_SEQUENCE_FLAG = 8;
exports.GSS_C_CONF_FLAG = 16;
exports.GSS_C_INTEG_FLAG = 32;
exports.GSS_C_ANON_FLAG = 64;
exports.GSS_C_PROT_READY_FLAG = 128;
exports.GSS_C_TRANS_FLAG = 256;
exports.GSS_C_NO_OID = 0;
exports.GSS_MECH_OID_KRB5 = 9;
exports.GSS_MECH_OID_SPNEGO = 6;
