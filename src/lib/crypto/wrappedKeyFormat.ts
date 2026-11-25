/**
 * Versioned format for wrapped prompt keys (#27).
 *
 * A wrapped prompt key is the AES content key sealed to one unlock public key.
 * Prompts published before key versioning hold a bare base64 sealed box. New
 * payloads carry the unlock key version in the value itself:
 *
 *   unlock-key:v1:<keyId>:<base64 sealed box>
 *
 * Carrying the version alongside the ciphertext means decryption can always
 * select the matching private key during and after rotation, without a
 * separate lookup table that could drift from the data it describes.
 *
 * This module is pure (no env access) so both the browser publish path and
 * the server unlock path can import it.
 */

export const WRAPPED_KEY_VERSION_PREFIX = "unlock-key:v1:";
export const UNLOCK_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface ParsedWrappedKey {
  /** Key version recorded in the payload, or `null` for a legacy untagged value. */
  keyId: string | null;
  /** Base64 sealed box to open with the selected unlock key. */
  sealed: string;
}

export class WrappedKeyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrappedKeyFormatError";
  }
}

export function isValidUnlockKeyId(keyId: string): boolean {
  return UNLOCK_KEY_ID_PATTERN.test(keyId);
}

/** Tags a sealed key with the unlock key version that can open it. */
export function formatWrappedKey(keyId: string, sealedBase64: string): string {
  if (!isValidUnlockKeyId(keyId)) {
    throw new WrappedKeyFormatError("Unlock key id must be 1-64 characters of letters, digits, '.', '_' or '-'.");
  }
  if (sealedBase64.length === 0) {
    throw new WrappedKeyFormatError("Sealed key must not be empty.");
  }
  return `${WRAPPED_KEY_VERSION_PREFIX}${keyId}:${sealedBase64}`;
}

/**
 * Splits a stored wrapped key into its key version and sealed box. Untagged
 * values are returned with `keyId: null` so the caller can apply the legacy
 * key policy explicitly. Non-string input is passed through as legacy so the
 * caller's existing decryption error handling still applies.
 */
export function parseWrappedKey(value: unknown): ParsedWrappedKey {
  if (typeof value !== "string") {
    return { keyId: null, sealed: value as string };
  }
  if (!value.startsWith(WRAPPED_KEY_VERSION_PREFIX)) {
    return { keyId: null, sealed: value };
  }

  const rest = value.slice(WRAPPED_KEY_VERSION_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator === -1) {
    throw new WrappedKeyFormatError("Wrapped key version tag is missing its sealed key.");
  }
  const keyId = rest.slice(0, separator);
  const sealed = rest.slice(separator + 1);
  if (!isValidUnlockKeyId(keyId)) {
    throw new WrappedKeyFormatError("Wrapped key carries a malformed unlock key version.");
  }
  if (sealed.length === 0) {
    throw new WrappedKeyFormatError("Wrapped key version tag has an empty sealed key.");
  }
  return { keyId, sealed };
}
