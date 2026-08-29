/**
 * Integration of IPFS failover + integrity verification into unlock flow
 */

import { getGatewayPool } from "./gateway";
import {
  verifyCiphertextIntegrity,
  verifyPlaintextIntegrity,
  isValidBinaryContent,
  computeHash,
} from "./integrity";

export interface UnlockIntegrityConfig {
  ciphertextHash?: string; // Contract-committed ciphertext hash
  plaintextHash?: string; // Contract-committed plaintext hash
  maxCiphertextSize?: number;
}

/**
 * Fetch and verify ciphertext from IPFS with failover
 *
 * @param cid IPFS content hash
 * @param config Integrity verification config from contract
 * @returns Verified ciphertext bytes
 * @throws if CID unreachable or integrity check fails
 */
export async function fetchVerifiedCiphertext(
  cid: string,
  config: UnlockIntegrityConfig,
): Promise<Uint8Array> {
  const pool = getGatewayPool();

  try {
    // Fetch with failover
    const response = await pool.fetchWithFailover(cid);

    // Validate binary content (not HTML/JSON error)
    if (!isValidBinaryContent(response.content)) {
      throw new Error(
        "Retrieved content is not valid binary (HTML/JSON error page detected)",
      );
    }

    // Verify ciphertext matches contract hash
    if (config.ciphertextHash) {
      const verification = verifyCiphertextIntegrity(
        response.content,
        config.ciphertextHash,
      );
      if (!verification.valid) {
        const errorMsg = verification.errors.join("; ");
        throw new Error(`Ciphertext integrity check failed: ${errorMsg}`);
      }
    }

    return response.content;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch and verify ciphertext from IPFS: ${message}`,
    );
  }
}

/**
 * Verify decrypted plaintext against contract-stored hash
 *
 * @param plaintext Decrypted content
 * @param config Integrity verification config from contract
 * @returns plaintext if valid
 * @throws if integrity check fails
 */
export function verifyDecryptedPlaintext(
  plaintext: string,
  config: UnlockIntegrityConfig,
): string {
  if (!config.plaintextHash) {
    // No verification required
    return plaintext;
  }

  const verification = verifyPlaintextIntegrity(
    plaintext,
    config.plaintextHash,
  );
  if (!verification.valid) {
    const errorMsg = verification.errors.join("; ");
    throw new Error(`Plaintext integrity check failed: ${errorMsg}`);
  }

  return plaintext;
}

/**
 * Get gateway health status (for monitoring/debugging)
 * Does NOT log ciphertext or secrets
 */
export function getGatewayHealthStatus() {
  const pool = getGatewayPool();
  const health = pool.getHealth();

  return {
    timestamp: new Date().toISOString(),
    gateways: health.map((h) => ({
      url: h.url,
      successCount: h.successCount,
      failureCount: h.failureCount,
      successRate: pool.getSuccessRate(h.url),
      isCircuitOpen: h.isCircuitOpen,
      lastError: h.lastError ? "(error occurred)" : undefined, // Don't log actual error
      lastErrorTime: h.lastErrorTime,
    })),
  };
}

/**
 * Record incident when gateways disagree
 * For audit trail / monitoring
 */
export interface DisagreementIncident {
  incident: "gateway_disagreement";
  cid: string;
  conflictingHashes: Array<{
    gateway: string;
    cidHash: string;
  }>;
  timestamp: string;
}

export function recordGatewayDisagreement(
  cid: string,
  conflictingResults: Array<{ gateway: string; cidHash: string }>,
): DisagreementIncident {
  return {
    incident: "gateway_disagreement",
    cid,
    conflictingHashes: conflictingResults,
    timestamp: new Date().toISOString(),
  };
}
