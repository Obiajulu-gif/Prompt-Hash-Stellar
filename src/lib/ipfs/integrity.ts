/**
 * Content Integrity Verification
 *
 * Verifies that retrieved IPFS content matches the contract-committed hash
 * and hasn't been tampered with, truncated, or substituted.
 */

import { sha256 } from "js-sha256";

export interface IntegrityVerification {
  valid: boolean;
  errors: string[];
  retrievedHash?: string;
  contractHash?: string;
  cidHash?: string;
}

/**
 * Verify retrieved ciphertext matches contract-committed hash
 */
export function verifyCiphertextIntegrity(
  ciphertext: Uint8Array,
  expectedHash: string,
): IntegrityVerification {
  const errors: string[] = [];

  // Check ciphertext size (shouldn't be empty or suspiciously small)
  if (ciphertext.length === 0) {
    errors.push("Ciphertext is empty");
  }
  if (ciphertext.length < 16) {
    errors.push("Ciphertext appears truncated (< 16 bytes)");
  }

  // Compute hash of retrieved ciphertext
  const retrievedHash = computeHash(ciphertext);

  // Compare with contract-committed hash
  if (retrievedHash !== expectedHash) {
    errors.push(
      `Ciphertext hash mismatch: expected ${expectedHash}, got ${retrievedHash}`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    retrievedHash,
    contractHash: expectedHash,
  };
}

/**
 * Verify decrypted plaintext against contract-stored hash
 */
export function verifyPlaintextIntegrity(
  plaintext: string,
  expectedHash: string,
): IntegrityVerification {
  const errors: string[] = [];

  // Check plaintext is valid UTF-8 and not HTML/JSON escape
  try {
    // If plaintext looks like HTML, it's likely a 404 or error page
    if (
      plaintext.toLowerCase().includes("<!doctype") ||
      plaintext.toLowerCase().includes("<html") ||
      (plaintext.trim().startsWith("{") && plaintext.includes("error"))
    ) {
      errors.push(
        "Retrieved content appears to be HTML or error JSON, not plaintext",
      );
    }
  } catch {
    errors.push("Plaintext is not valid UTF-8");
  }

  // Compute hash of plaintext
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const retrievedHash = computeHash(plaintextBytes);

  // Compare with contract hash
  if (retrievedHash !== expectedHash) {
    errors.push(
      `Plaintext hash mismatch: expected ${expectedHash}, got ${retrievedHash}`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    retrievedHash,
    contractHash: expectedHash,
  };
}

/**
 * Verify CID resolves to consistent content across multiple gateways
 */
export function verifyCIDConsistency(
  results: Array<{ cidHash: string; gateway: string }>,
): IntegrityVerification {
  const errors: string[] = [];

  if (results.length === 0) {
    errors.push("No gateway results to verify");
    return { valid: false, errors };
  }

  // Check all gateways resolved to same CID hash
  const firstHash = results[0].cidHash;
  for (const result of results.slice(1)) {
    if (result.cidHash !== firstHash) {
      errors.push(
        `CID disagreement: ${results[0].gateway}=${firstHash}, ${result.gateway}=${result.cidHash}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    cidHash: firstHash,
  };
}

/**
 * Compute SHA256 hash of bytes, formatted as hex string
 */
export function computeHash(data: Uint8Array): string {
  const hashArray = sha256.array(data);
  return (
    "0x" +
    Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Check if response content looks like a valid binary blob (not HTML/JSON error)
 */
export function isValidBinaryContent(data: Uint8Array): boolean {
  if (data.length === 0) return false;

  // Check for HTML markers
  const firstChars = new TextDecoder().decode(data.slice(0, 100)).toLowerCase();
  if (
    firstChars.includes("<!doctype") ||
    firstChars.includes("<html") ||
    firstChars.includes("<body")
  ) {
    return false;
  }

  // Check for JSON error responses
  if (firstChars.trim().startsWith("{")) {
    try {
      const json = JSON.parse(firstChars);
      if (json.error || json.message) {
        return false;
      }
    } catch {
      // Not JSON, OK
    }
  }

  return true;
}

/**
 * Validate that decryption result matches expected length
 */
export function validatePlaintextLength(
  plaintext: string,
  expectedMinLength?: number,
  expectedMaxLength?: number,
): IntegrityVerification {
  const errors: string[] = [];

  if (expectedMinLength && plaintext.length < expectedMinLength) {
    errors.push(
      `Plaintext too short: ${plaintext.length} < ${expectedMinLength}`,
    );
  }

  if (expectedMaxLength && plaintext.length > expectedMaxLength) {
    errors.push(
      `Plaintext too long: ${plaintext.length} > ${expectedMaxLength}`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
