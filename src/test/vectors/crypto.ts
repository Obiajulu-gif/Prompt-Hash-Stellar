/**
 * Stable, deterministic cryptographic test vectors shared by frontend and
 * unlock-service tests.
 *
 * ## Generation rules
 * - All values are deterministic and checked into version control.
 * - No production secrets — these are throwaway keys.
 * - AES-256-GCM: 256-bit key (32 bytes) + 96-bit IV (12 bytes).  The
 *   ciphertext includes the 16-byte GCM authentication tag appended.
 * - NaCl box keypair: derived from a fixed 32-byte seed via
 *   `crypto_box_seed_keypair` so that every run produces the same keys.
 * - Content hash: SHA-256 of the plaintext, hex-encoded (64 hex chars).
 *
 * ## Regenerating values
 * ```bash
 * node -e "
 *   const c = require('crypto');
 *   const k = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f','hex');
 *   const i = Buffer.from('0102030405060708090a0b0c','hex');
 *   const p = 'Hello, this is a known test plaintext for deterministic crypto verification.';
 *   const ciph = c.createCipheriv('aes-256-gcm', k, i);
 *   const out = Buffer.concat([ciph.update(p,'utf8'), ciph.final(), ciph.getAuthTag()]);
 *   console.log('ciphertext base64:', out.toString('base64'));
 *   console.log('sha256 hex:', c.createHash('sha256').update(p).digest('hex'));
 * "
 * ```
 */

/** Plaintext used in all encryption / decryption tests. */
export const PLAINTEXT =
  "Hello, this is a known test plaintext for deterministic crypto verification.";

// ── AES-256-GCM ────────────────────────────────────────────────────────

/** 32-byte AES-256 key as lowercase hex. */
export const AES_KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

/** 12-byte AES-GCM IV as lowercase hex. */
export const AES_IV_HEX = "0102030405060708090a0b0c";

/**
 * Expected ciphertext (AES-256-GCM with the key and IV above).
 * The 16-byte GCM authentication tag is appended — this matches the output
 * of Web Crypto's `crypto.subtle.encrypt`.
 */
export const CIPHERTEXT_BASE64 =
  "TY82uYO40PIkyxBneWDKSWIoj5HgA3CxxCyNBO7aF6zqkP6nGpWK8MKM3oCxvoow95gmk6DwVVFVD3W9G24UehIPYkXWkjyUIn3eVLwzy/3zXozWA3tQJUnihng=";

/** SHA-256 content hash of `PLAINTEXT`, hex-encoded (64 characters). */
export const CONTENT_HASH =
  "a7efa25451cc68889c1b424df7dff537a5ce9c7ea6156edecccc2abd28e74b0c";

/** Ciphertext with one byte flipped — decryption MUST fail. */
export const TAMPERED_CIPHERTEXT_BASE64 =
  "TI82uYO40PIkyxBneWDKSWIoj5HgA3CxxCyNBO7aF6zqkP6nGpWK8MKM3oCxvoow95gmk6DwVVFVD3W9G24UehIPYkXWkjyUIn3eVLwzy/3zXozWA3tQJUnihng=";

// ── NaCl box keypair (sealed-key wrapping) ─────────────────────────────

/** 32-byte seed for `crypto_box_seed_keypair` — produces stable keys. */
export const SEAL_SEED_HEX =
  "deadbeefcafebabedeadbeefcafebabedeadbeefcafebabedeadbeefcafebabe";

/** Public key (base64) of the deterministic keypair derived from `SEAL_SEED_HEX`. */
export const SEAL_PUBLIC_KEY_BASE64 =
  "nkzWF3A3tpfzkx+zFbBXGEPhOPTj6RDA9AqiLZdS/R4=";

/** Private key (base64) of the deterministic keypair derived from `SEAL_SEED_HEX`. */
export const SEAL_PRIVATE_KEY_BASE64 =
  "UbjCkjioQD4Kxp4j1HuRhMNxqSRg1Rg1GwmZRLvfqGc=";

/**
 * The AES key (matching `AES_KEY_HEX`) pre-wrapped with the NaCl seal
 * keypair above — i.e. `crypto_box_seal(aesKeyBytes, sealPublicKey)`.
 */
export const WRAPPED_AES_KEY_BASE64 =
  "x8ipqGNE+Lbmc3bgvr8NOqdjL9BXW+gn0C1eD+zaT1ENdkKfj99bKKjG9nH8w4qGVGMHP51T17um2+KvdLdccG98kJ1l1kT6xEApVpux1jM=";

// ── Invalid / edge-case inputs ─────────────────────────────────────────

/** Not valid base64 at all. */
export const INVALID_BASE64 = "!!!not-base64!!!";

/** Valid base64 but only 4 bytes — too short to be a real AES key or ciphertext. */
export const SHORT_BASE64 = "AAAA";