// @vitest-environment node

import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  buildChallengeMessage,
  createChallengeToken,
  globalNonceLedger,
} from "../../../src/lib/auth/challenge";
import { ErrorCode } from "../../../src/lib/api/errorCodes";
import { CONTENT_HASH, PLAINTEXT } from "../../../src/test/vectors/crypto";
import { clearIdempotencyCache } from "../../../src/lib/observability/idempotency";

const hasAccessMock = vi.fn();
const verifyEntitlementMock = vi.fn();
const getPromptMock = vi.fn();
const unwrapPromptKeyMock = vi.fn();
const decryptPromptCiphertextMock = vi.fn();
const hashPromptPlaintextMock = vi.fn();

vi.mock("../../../src/lib/stellar/promptHashClient", () => ({
  hasAccess: (...args: unknown[]) => hasAccessMock(...args),
  verifyEntitlement: (...args: unknown[]) => verifyEntitlementMock(...args),
  getPrompt: (...args: unknown[]) => getPromptMock(...args),
  DEFAULT_MAX_LEDGER_AGE: 5,
}));

vi.mock("../../../src/lib/crypto/promptCrypto", () => ({
  unwrapPromptKey: (...args: unknown[]) => unwrapPromptKeyMock(...args),
  decryptPromptCiphertext: (...args: unknown[]) => decryptPromptCiphertextMock(...args),
  hashPromptPlaintext: (...args: unknown[]) => hashPromptPlaintextMock(...args),
  normalizeContentHash: (hash: string) => hash.toLowerCase(),
}));

vi.mock("../../../src/lib/observability/wrapper", () => ({
  withObservability: (handler: unknown) => handler,
}));

vi.mock("../../../src/lib/observability/rateLimiter", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    success: true,
    limit: 100,
    remaining: 99,
    reset: 60_000,
  }),
}));

vi.mock("../../../src/lib/observability/metrics", () => ({
  metrics: {
    emit: vi.fn(),
    trackUnlockSuccess: vi.fn(),
    trackUnlockFailure: vi.fn(),
    trackRateLimitHit: vi.fn(),
    trackUnlockLatency: vi.fn(),
  },
}));

vi.mock("../../services/auditTrail", () => ({
  recordAuditEvent: vi.fn(),
}));

import handler from "../../../api/prompts/unlock";

async function setupAdversarialFixture(secret = "adversarial-primary-secret") {
  const buyer = Keypair.random();
  const promptId = "101";

  process.env.CHALLENGE_TOKEN_SECRET = secret;
  process.env.UNLOCK_PUBLIC_KEY = "d".repeat(32);
  process.env.UNLOCK_PRIVATE_KEY = "e".repeat(32);
  process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID =
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  process.env.PUBLIC_STELLAR_SIMULATION_ACCOUNT = buyer.publicKey();

  verifyEntitlementMock.mockResolvedValue({
    hasAccess: true,
    ledgerSequence: 200000,
    ledgerHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    networkId: "testnet",
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    checkedAt: Date.now(),
  });

  getPromptMock.mockResolvedValue({
    id: 101n,
    creator: "GCREATOR123",
    title: "Adversarial Test Prompt",
    contentHash: CONTENT_HASH,
    encryptedPrompt: "ciphertext-blob",
    encryptionIv: "iv-blob",
    wrappedKey: "wrapped-key-blob",
  });

  unwrapPromptKeyMock.mockResolvedValue(new Uint8Array(32));
  decryptPromptCiphertextMock.mockResolvedValue(PLAINTEXT);
  hashPromptPlaintextMock.mockResolvedValue(CONTENT_HASH);

  return { buyer, promptId, secret };
}

async function invokeUnlockReq(body: Record<string, unknown>) {
  let statusCode = 0;
  let responseData: Record<string, unknown> = {};

  const req = {
    method: "POST",
    headers: {},
    body,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    requestId: "adv-request-id",
    socket: { remoteAddress: "127.0.0.1" },
  };

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: Record<string, unknown>) {
      responseData = data;
      return this;
    },
    setHeader: vi.fn(),
  };

  // @ts-expect-error test handler invocation
  await handler(req, res);

  return { statusCode, responseData };
}

describe("Adversarial Unlock Service Harness (#604 / #428)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalNonceLedger.clear();
    clearIdempotencyCache();
    delete process.env.CHALLENGE_TOKEN_SECRET_PREVIOUS;
    delete process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP;
    delete process.env.CHALLENGE_TOKEN_GRACE_PERIOD_MS;
  });

  it("1. Replaying a previously-consumed nonce is rejected via globalNonceLedger", async () => {
    const { buyer, promptId, secret } = await setupAdversarialFixture();
    const challenge = createChallengeToken(secret, buyer.publicKey(), promptId);
    const signedMessage = Buffer.from(
      buyer.sign(Buffer.from(challenge.challenge, "utf8")),
    ).toString("base64");

    // First attempt succeeds
    const firstRes = await invokeUnlockReq({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });
    expect(firstRes.statusCode).toBe(200);
    expect(firstRes.responseData.plaintext).toBe(PLAINTEXT);

    // Replaying same token/nonce must fail
    const replayRes = await invokeUnlockReq({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });
    expect(replayRes.statusCode).toBe(400);
    expect(replayRes.responseData.code).toBe(ErrorCode.TEMPORARY_FAILURE);
    expect(String(replayRes.responseData.error)).toContain("already been processed");
  });

  it("2. Signature valid for a different promptId or address pair is rejected", async () => {
    const { buyer, promptId, secret } = await setupAdversarialFixture();
    const attacker = Keypair.random();

    // Attacker signs a challenge message generated for promptId "999" and attacker address
    const fakeChallengeMsg = buildChallengeMessage({
      address: attacker.publicKey(),
      promptId: "999",
      nonce: "fake-nonce",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    const tamperedSignature = Buffer.from(
      attacker.sign(Buffer.from(fakeChallengeMsg, "utf8")),
    ).toString("base64");

    const challenge = createChallengeToken(secret, buyer.publicKey(), promptId);

    // Submit with buyer's challenge token but attacker's tampered signature
    const res = await invokeUnlockReq({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage: tamperedSignature,
    });

    expect(res.statusCode).toBe(401);
    expect(res.responseData.code).toBe(ErrorCode.INVALID_SIGNATURE);
    expect(res.responseData.plaintext).toBeUndefined();
  });

  it("3. Token signed with rotated-out previous secret is accepted during grace period and rejected after it", async () => {
    const primarySecret = "primary-secret-v2-long-enough";
    const previousSecret = "previous-secret-v1-long-enough";
    const { buyer, promptId } = await setupAdversarialFixture(primarySecret);

    process.env.CHALLENGE_TOKEN_SECRET_PREVIOUS = previousSecret;
    process.env.CHALLENGE_TOKEN_GRACE_PERIOD_MS = "60000"; // 60s grace period

    // Token signed with previousSecret
    const challenge = createChallengeToken(previousSecret, buyer.publicKey(), promptId);
    const signedMessage = Buffer.from(
      buyer.sign(Buffer.from(challenge.challenge, "utf8")),
    ).toString("base64");

    // Case A: Within grace period (rotated 10s ago)
    process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP = String(Date.now() - 10_000);
    const inGraceRes = await invokeUnlockReq({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });
    expect(inGraceRes.statusCode).toBe(200);
    expect(inGraceRes.responseData.plaintext).toBe(PLAINTEXT);

    // Clear nonce so we can test past-grace behavior with a new token from previousSecret
    globalNonceLedger.clear();

    // Case B: Expired grace period (rotated 120s ago, grace period is 60s)
    process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP = String(Date.now() - 120_000);
    const challenge2 = createChallengeToken(previousSecret, buyer.publicKey(), promptId);
    const signedMessage2 = Buffer.from(
      buyer.sign(Buffer.from(challenge2.challenge, "utf8")),
    ).toString("base64");

    const pastGraceRes = await invokeUnlockReq({
      token: challenge2.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage: signedMessage2,
    });

    expect(pastGraceRes.statusCode).toBe(400);
    expect(pastGraceRes.responseData.plaintext).toBeUndefined();
  });

  it("4. Two concurrent requests with the same nonce: exactly one succeeds", async () => {
    const { buyer, promptId, secret } = await setupAdversarialFixture();
    const challenge = createChallengeToken(secret, buyer.publicKey(), promptId);
    const signedMessage = Buffer.from(
      buyer.sign(Buffer.from(challenge.challenge, "utf8")),
    ).toString("base64");

    const reqPayload = {
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    };

    // Run both unlock requests concurrently
    const [res1, res2] = await Promise.all([
      invokeUnlockReq(reqPayload),
      invokeUnlockReq(reqPayload),
    ]);

    const statusCodes = [res1.statusCode, res2.statusCode].sort();
    expect(statusCodes).toEqual([200, 400]);

    const successRes = res1.statusCode === 200 ? res1 : res2;
    const failRes = res1.statusCode === 400 ? res1 : res2;

    expect(successRes.responseData.plaintext).toBe(PLAINTEXT);
    expect(failRes.responseData.code).toBe(ErrorCode.TEMPORARY_FAILURE);
  });

  it("5. Tampered contentHash on-chain vs decrypted plaintext hash mismatch triggers integrity failure without leaking plaintext", async () => {
    const { buyer, promptId, secret } = await setupAdversarialFixture();
    const challenge = createChallengeToken(secret, buyer.publicKey(), promptId);
    const signedMessage = Buffer.from(
      buyer.sign(Buffer.from(challenge.challenge, "utf8")),
    ).toString("base64");

    // Simulate hash mismatch (tampered content)
    hashPromptPlaintextMock.mockResolvedValue("tampered-mismatched-sha256-digest-value");

    const res = await invokeUnlockReq({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(res.statusCode).toBe(500);
    expect(res.responseData.code).toBe(ErrorCode.INTEGRITY_FAILURE);
    expect(res.responseData.error).toBe("Prompt integrity check failed.");
    expect(res.responseData.plaintext).toBeUndefined();
  });
});
