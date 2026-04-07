// Minimal argon2 shim — replaces the native C binding.
//
// Uses Node.js built-in crypto.argon2 (available since v22.5.0) for real
// Argon2 hashing when available, falling back to crypto.scrypt as a
// self-consistent KDF with Argon2 PHC string encoding.

const crypto = require("node:crypto");
const { scrypt, randomBytes, timingSafeEqual } = crypto;

const argon2d = 0;
const argon2i = 1;
const argon2id = 2;

const TYPE_NAMES = ["argon2d", "argon2i", "argon2id"];

const DEFAULTS = {
  hashLength: 32,
  timeCost: 3,
  memoryCost: 65536, // 1 << 16
  parallelism: 4,
  type: argon2id,
  version: 0x13,
};

const _hasNativeArgon2 = typeof crypto.argon2 === "function";

/**
 * Hash a password.
 * @param {Buffer | string} password
 * @param {object} [options]
 * @returns {Promise<string | Buffer>}
 */
function hash(password, options) {
  const opts = { ...DEFAULTS, ...options };
  const salt = opts.salt || randomBytes(16);
  const keylen = opts.hashLength || 32;
  const typeStr = TYPE_NAMES[opts.type] || "argon2id";

  const derive = _hasNativeArgon2
    ? () => _deriveArgon2(typeStr, password, salt, keylen, opts)
    : () => _deriveScrypt(password, salt, keylen, opts);

  return derive().then((derived) => {
    if (opts.raw) return derived;
    return (
      `$${typeStr}$v=${opts.version}` +
      `$m=${opts.memoryCost},t=${opts.timeCost},p=${opts.parallelism}` +
      `$${salt.toString("base64url")}` +
      `$${derived.toString("base64url")}`
    );
  });
}

/**
 * Verify a password against a PHC-encoded hash.
 * @param {string} digest
 * @param {Buffer | string} password
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
async function verify(digest, password, options) {
  const parsed = _parsePHC(digest);
  if (!parsed) return false;
  const rehashed = await hash(password, {
    ...parsed,
    raw: true,
    secret: options?.secret,
  });
  return timingSafeEqual(rehashed, parsed.hash);
}

/**
 * Check if a hash needs to be rehashed with new parameters.
 * @param {string} digest
 * @param {object} [options]
 * @returns {boolean}
 */
function needsRehash(digest, options) {
  const opts = { ...DEFAULTS, ...options };
  const parsed = _parsePHC(digest);
  if (!parsed) return true;
  return (
    parsed.version !== (opts.version || DEFAULTS.version) ||
    parsed.memoryCost !== (opts.memoryCost || DEFAULTS.memoryCost) ||
    parsed.timeCost !== (opts.timeCost || DEFAULTS.timeCost) ||
    parsed.parallelism !== (opts.parallelism || DEFAULTS.parallelism)
  );
}

// --- internal helpers ---

/** Derive key using native crypto.argon2 */
function _deriveArgon2(algorithm, password, salt, keylen, opts) {
  return new Promise((resolve, reject) => {
    crypto.argon2(
      algorithm,
      {
        message: Buffer.from(password),
        nonce: salt,
        memory: opts.memoryCost,
        passes: opts.timeCost,
        parallelism: opts.parallelism,
        tagLength: keylen,
        secret: opts.secret ? Buffer.from(opts.secret) : Buffer.alloc(0),
        associatedData: opts.associatedData ? Buffer.from(opts.associatedData) : Buffer.alloc(0),
      },
      (err, derived) => {
        if (err) return reject(err);
        resolve(derived);
      },
    );
  });
}

/** Derive key using scrypt (fallback) */
function _deriveScrypt(password, salt, keylen, opts) {
  const N = _nearestPow2(Math.max(opts.memoryCost >> 3, 1024));
  const r = Math.max(opts.timeCost, 1) * 2;
  const p = Math.max(opts.parallelism, 1);
  const maxmem = N * 128 * r + 64 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    scrypt(Buffer.from(password), salt, keylen, { N, r, p, maxmem }, (err, derived) => {
      if (err) return reject(err);
      resolve(derived);
    });
  });
}

/** Parse a PHC-formatted argon2 string */
function _parsePHC(encoded) {
  const parts = encoded.split("$").filter(Boolean);
  if (parts.length < 5) return null;
  const type = parts[0] === "argon2d" ? 0 : parts[0] === "argon2i" ? 1 : 2;
  const version = Number.parseInt(parts[1].replace("v=", ""), 10) || 0x13;
  const params = {};
  for (const kv of parts[2].split(",")) {
    const [k, v] = kv.split("=");
    params[k] = Number.parseInt(v, 10);
  }
  return {
    type,
    version,
    memoryCost: params.m || DEFAULTS.memoryCost,
    timeCost: params.t || DEFAULTS.timeCost,
    parallelism: params.p || DEFAULTS.parallelism,
    salt: Buffer.from(parts[3], "base64url"),
    hash: Buffer.from(parts[4], "base64url"),
    hashLength: Buffer.from(parts[4], "base64url").length,
  };
}

/** Round up to nearest power of 2 */
function _nearestPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

module.exports = { hash, verify, needsRehash, argon2d, argon2i, argon2id };
