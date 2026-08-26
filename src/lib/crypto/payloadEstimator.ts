/**
 * Encrypted Payload Size Estimator Module (#458)
 *
 * Calculates approximate ciphertext, IV, wrapped key, content hash, and total payload size
 * before a creator submits a prompt listing to Soroban.
 */

export const MAX_ENCRYPTED_PROMPT_LIMIT = 4096; // 4KB contract limit
export const MAX_WRAPPED_KEY_LIMIT = 256;
export const MAX_IV_LIMIT = 64;

export interface EncryptedPayloadEstimate {
  plaintextSizeBytes: number;
  ciphertextSizeBytes: number; // Raw AES-GCM ciphertext + 16-byte tag
  ciphertextBase64Length: number; // 4 * Math.ceil(ciphertextSizeBytes / 3)
  ivBase64Length: number; // 16 base64 characters
  wrappedKeyBase64Length: number; // 108 base64 characters (80 bytes sealed key)
  contentHashLength: number; // 64 hex characters
  totalPayloadBytes: number; // Main encrypted payload base64 length compared against 4096 limit
  totalMetadataBytes: number; // Sum of all payload components (ciphertext + IV + wrapped key + hash)
  limitBytes: number;
  percentageOfLimit: number;
  isOverLimit: boolean;
  excessBytes: number;
  suggestedTrimChars: number;
  guidance: string;
}

const encoder = new TextEncoder();

/**
 * Estimate encrypted payload sizes from plaintext.
 *
 * @param plaintext Prompt text to be encrypted
 * @param limit Max allowed encrypted payload limit in bytes (default 4096)
 */
export function estimateEncryptedPayloadSize(
  plaintext = "",
  limit = MAX_ENCRYPTED_PROMPT_LIMIT
): EncryptedPayloadEstimate {
  const plaintextSizeBytes = encoder.encode(plaintext || "").length;

  // AES-GCM adds a 16-byte authentication tag
  const ciphertextSizeBytes = plaintextSizeBytes > 0 ? plaintextSizeBytes + 16 : 0;

  // Base64 encoding turns every 3 bytes into 4 characters
  const ciphertextBase64Length = ciphertextSizeBytes > 0
    ? Math.ceil(ciphertextSizeBytes / 3) * 4
    : 0;

  // 12-byte IV -> 16 base64 characters
  const ivBase64Length = plaintextSizeBytes > 0 ? 16 : 0;

  // 32-byte AES key + 48-byte libsodium box seal overhead = 80 bytes -> 108 base64 characters
  const wrappedKeyBase64Length = plaintextSizeBytes > 0 ? 108 : 0;

  // SHA-256 digest = 32 bytes -> 64 hex characters
  const contentHashLength = plaintextSizeBytes > 0 ? 64 : 0;

  // Primary contract payload limit check is on ciphertextBase64Length against 4096
  const totalPayloadBytes = ciphertextBase64Length;
  const totalMetadataBytes = ciphertextBase64Length + ivBase64Length + wrappedKeyBase64Length + contentHashLength;

  const percentageOfLimit = limit > 0 ? (totalPayloadBytes / limit) * 100 : 0;
  const isOverLimit = totalPayloadBytes > limit;
  const excessBytes = isOverLimit ? totalPayloadBytes - limit : 0;

  // Base64 turns 3 bytes into 4 chars, so trimming X chars corresponds to ~ (X * 3 / 4) plaintext bytes
  const suggestedTrimChars = isOverLimit ? Math.ceil((excessBytes * 3) / 4) + 10 : 0;

  let guidance = "";
  if (plaintextSizeBytes === 0) {
    guidance = "Enter prompt text to estimate encrypted payload size.";
  } else if (isOverLimit) {
    guidance = `Encrypted payload exceeds the ${limit} byte contract limit by ${excessBytes} bytes. Please trim your prompt text by ~${suggestedTrimChars} characters or enable IPFS off-chain storage.`;
  } else if (percentageOfLimit > 85) {
    guidance = `Payload is approaching the ${limit} byte limit (${percentageOfLimit.toFixed(1)}%). Consider keeping room for minor updates.`;
  } else {
    guidance = `Payload size is within valid contract limits (${percentageOfLimit.toFixed(1)}% of limit).`;
  }

  return {
    plaintextSizeBytes,
    ciphertextSizeBytes,
    ciphertextBase64Length,
    ivBase64Length,
    wrappedKeyBase64Length,
    contentHashLength,
    totalPayloadBytes,
    totalMetadataBytes,
    limitBytes: limit,
    percentageOfLimit: Math.min(percentageOfLimit, 100),
    isOverLimit,
    excessBytes,
    suggestedTrimChars,
    guidance,
  };
}
