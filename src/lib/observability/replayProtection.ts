import { hashKey, replayStore as store } from "./sharedStore";

interface ReplayCheckConfig {
  ttlMs: number;
}

const defaultConfig: ReplayCheckConfig = {
  ttlMs: 10 * 60 * 1000,
};

function computeSignatureHash(token: string, signedMessage: string): string {
  return hashKey(`${token}:${signedMessage}`);
}

/**
 * Check and record a signature for replay protection.
 *
 * Returns `{ valid: true }` if this signature has not been seen before.
 * Returns `{ valid: false, reason }` if it was already consumed (replay).
 *
 * Fail-closed: throws if the shared store is unreachable in production.
 */
export async function checkReplayProtection(
  token: string,
  signedMessage: string,
  config: Partial<ReplayCheckConfig> = {},
): Promise<{ valid: boolean; reason?: string }> {
  const finalConfig = { ...defaultConfig, ...config };
  const signatureHash = computeSignatureHash(token, signedMessage);

  const isValid = await store.consume(signatureHash, finalConfig.ttlMs);
  if (!isValid) {
    return { valid: false, reason: "replay_detected" };
  }
  return { valid: true };
}
