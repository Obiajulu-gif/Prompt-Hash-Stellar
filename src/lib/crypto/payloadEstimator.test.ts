import { describe, it, expect } from 'vitest';
import {
  estimateEncryptedPayloadSize,
  MAX_ENCRYPTED_PROMPT_LIMIT,
} from './payloadEstimator';

describe('Encrypted Payload Size Estimator (#458)', () => {
  it('handles empty prompt string', () => {
    const estimate = estimateEncryptedPayloadSize('');

    expect(estimate.plaintextSizeBytes).toBe(0);
    expect(estimate.ciphertextSizeBytes).toBe(0);
    expect(estimate.ciphertextBase64Length).toBe(0);
    expect(estimate.isOverLimit).toBe(false);
    expect(estimate.percentageOfLimit).toBe(0);
  });

  it('accurately calculates AES-GCM ciphertext Base64 size for normal plaintext', () => {
    // 100 bytes plaintext -> AES-GCM adds 16 bytes tag = 116 bytes.
    // Base64 encoding: Math.ceil(116 / 3) * 4 = 39 * 4 = 156 characters.
    const text100 = 'a'.repeat(100);
    const estimate = estimateEncryptedPayloadSize(text100, 4096);

    expect(estimate.plaintextSizeBytes).toBe(100);
    expect(estimate.ciphertextSizeBytes).toBe(116);
    expect(estimate.ciphertextBase64Length).toBe(156);
    expect(estimate.ivBase64Length).toBe(16);
    expect(estimate.wrappedKeyBase64Length).toBe(108);
    expect(estimate.contentHashLength).toBe(64);
    expect(estimate.isOverLimit).toBe(false);
    expect(estimate.totalPayloadBytes).toBe(156);
  });

  it('tests exact boundary value at limit', () => {
    // Max base64 payload is 4096. 4096 base64 chars = 3072 raw bytes.
    // Raw ciphertext (including 16-byte tag) = 3072 bytes => Plaintext = 3056 bytes.
    const text3056 = 'b'.repeat(3056);
    const estimateAtLimit = estimateEncryptedPayloadSize(text3056, 4096);

    expect(estimateAtLimit.ciphertextBase64Length).toBe(4096);
    expect(estimateAtLimit.isOverLimit).toBe(false);
    expect(estimateAtLimit.percentageOfLimit).toBe(100);

    // 1 byte larger -> plaintext 3057 bytes => ciphertext 3073 bytes -> Base64 4098 chars (over limit!)
    const text3057 = 'b'.repeat(3057);
    const estimateOverLimit = estimateEncryptedPayloadSize(text3057, 4096);

    expect(estimateOverLimit.ciphertextBase64Length).toBe(4098);
    expect(estimateOverLimit.isOverLimit).toBe(true);
    expect(estimateOverLimit.excessBytes).toBe(2);
    expect(estimateOverLimit.guidance).toContain('exceeds the 4096 byte contract limit');
  });

  it('provides over-limit guidance explaining how to reduce payload size', () => {
    const oversizedText = 'x'.repeat(4000);
    const estimate = estimateEncryptedPayloadSize(oversizedText, MAX_ENCRYPTED_PROMPT_LIMIT);

    expect(estimate.isOverLimit).toBe(true);
    expect(estimate.suggestedTrimChars).toBeGreaterThan(0);
    expect(estimate.guidance).toContain('Please trim your prompt text');
    expect(estimate.guidance).toContain('IPFS off-chain storage');
  });
});
