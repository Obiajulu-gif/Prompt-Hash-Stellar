// @vitest-environment node

import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  buildChallengeMessage,
  createChallengeToken,
  globalNonceLedger,
} from "../../src/lib/auth/challenge";
import { ErrorCode } from "../../src/lib/api/errorCodes";
import { CONTENT_HASH, PLAINTEXT } from "../../src/test/vectors/crypto";
import { clearIdempotencyCache } from "../../src/lib/observability/idempotency";

const hasAccessMock = vi.fn();
const verifyEntitlementMock = vi.fn();
const getPromptMock = vi.fn();
const unwrapPromptKeyMock = vi.fn();
const decryptPromptCiphertextMock = vi.fn();
const hashPromptPlaintextMock = vi.fn();

vi.mock("../../src/lib/stellar/promptHashClient", () => ({
  hasAccess: (...args: unknown[]) => hasAccessMock(...args),
  verifyEntitlement: (...args: unknown[]) => verifyEntitlementMock(...args),
  getPrompt: (...args: unknown[]) => getPromptMock(...args),
  DEFAULT_MAX_LEDGER_AGE: 5,
}));

vi.mock("../../src/lib/crypto/promptCrypto", () => ({
  unwrapPromptKey: (...args: unknown[]) => unwrapPromptKeyMock(...args),
  decryptPromptCiphertext: (...args: unknown[]) => decryptPromptCiphertextMock(...args),
  hashPromptPlaintext: (...args: unknown[]) => hashPromptPlaintextMock(...args),
  normalizeContentHash: (hash: string) => hash.toLowerCase(),
}));

vi.mock("../../src/lib/observability/wrapper", () => ({
  withObservability: (handler: unknown) => handler,
}));

vi.mock("../../src/lib/observability/rateLimiter", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: 60_000,
  }),
}));

vi.mock("../../src/lib/observability/metrics", () => ({
  metrics: {
    emit: vi.fn(),
    trackUnlockSuccess: vi.fn(),
    trackUnlockFailure: vi.fn(),
    trackRateLimitHit: vi.fn(),
  },
}));

vi.mock("../../server/src/services/auditTrail", () => ({
  recordAuditEvent: vi.fn(),
}));

vi.mock("../../server/src/services/webhookDispatcher", () => ({
  dispatchEvent: vi.fn().mockResolvedValue(undefined),
}));

import handler from "./unlock";

async function setupUnlockFixture(plaintext = PLAINTEXT) {
  const buyer = Keypair.random();
  const contentHash = CONTENT_HASH;

  process.env.CHALLENGE_TOKEN_SECRET = "integration-test-challenge-secret";
  process.env.UNLOCK_PUBLIC_KEY = "d".repeat(32);
  process.env.UNLOCK_PRIVATE_KEY = "e".repeat(32);
  process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID =
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  process.env.PUBLIC_STELLAR_SIMULATION_ACCOUNT = buyer.publicKey();
  process.env.PUBLIC_STELLAR_RPC_URL = "https://soroban-testnet.stellar.org";

  const promptId = "42";
  const challenge = createChallengeToken(
    process.env.CHALLENGE_TOKEN_SECRET,
    buyer.publicKey(),
    promptId,
  );
  const signedMessage = Buffer.from(
    buyer.sign(Buffer.from(challenge.challenge, "utf8")),
  ).toString("base64");

  verifyEntitlementMock.mockResolvedValue({
    hasAccess: true,
    ledgerSequence: 123456,
    ledgerHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    networkId: "testnet",
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    checkedAt: Date.now(),
  });
  hasAccessMock.mockResolvedValue(true);
  getPromptMock.mockResolvedValue({
    id: 42n,
    creator: "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
    title: "Test prompt",
    contentHash,
    encryptedPrompt: "encrypted",
    encryptionIv: "iv",
    wrappedKey: "wrapped",
  });
  unwrapPromptKeyMock.mockResolvedValue(new Uint8Array(32));
  decryptPromptCiphertextMock.mockResolvedValue(plaintext);
  hashPromptPlaintextMock.mockResolvedValue(contentHash);

  return { buyer, promptId, challenge, signedMessage, contentHash, plaintext };
}

async function invokeUnlock(body: Record<string, unknown>) {
  let statusCode = 0;
  let responseData: Record<string, unknown> = {};
  const errorLog = vi.fn();

  const req = {
    method: "POST",
    headers: {},
    body,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: errorLog,
    },
    requestId: "test-request",
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

  return { statusCode, responseData, errorLog };
}

describe("unlock API integrity checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns plaintext when decrypted content matches the stored hash", async () => {
    const { buyer, promptId, challenge, signedMessage, plaintext } =
      await setupUnlockFixture();

    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(statusCode).toBe(200);
    expect(responseData.plaintext).toBe(plaintext);
    expect(responseData.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails safely when the recomputed hash does not match", async () => {
    const { buyer, promptId, challenge, signedMessage } =
      await setupUnlockFixture("Matching plaintext body.");

    hashPromptPlaintextMock.mockResolvedValue("b".repeat(64));

    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(statusCode).toBe(500);
    expect(responseData.code).toBe(ErrorCode.INTEGRITY_FAILURE);
    expect(responseData.plaintext).toBeUndefined();
    expect(responseData.error).toBe("Prompt integrity check failed.");
  });

  it("does not expose decrypted content in generic error responses", async () => {
    const { buyer, promptId, challenge, signedMessage } =
      await setupUnlockFixture();

    getPromptMock.mockRejectedValue(new Error("Simulated backend failure"));

    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(statusCode).toBe(400);
    expect(responseData.code).toBe(ErrorCode.TEMPORARY_FAILURE);
    expect(responseData.plaintext).toBeUndefined();
    expect(String(responseData.error)).not.toContain("Secret prompt");
  });

  it("rejects unlock when wallet signature is invalid", async () => {
    const { buyer, promptId, challenge } = await setupUnlockFixture();
    const wrongSigner = Keypair.random();
    const signedMessage = Buffer.from(
      wrongSigner.sign(Buffer.from(challenge.challenge, "utf8")),
    ).toString("base64");

    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(statusCode).toBe(401);
    expect(responseData.code).toBe(ErrorCode.INVALID_SIGNATURE);
    expect(responseData.plaintext).toBeUndefined();
  });
});

describe("unlock challenge message contract", () => {
  it("uses the expected challenge message format", () => {
    const payload = {
      address: "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789",
      promptId: "7",
      nonce: "nonce-123",
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000,
    };

    expect(buildChallengeMessage(payload)).toBe(
      "prompt-hash unlock:GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789:7:nonce-123:1700000000000:1700000000000",
    );
  });
});

describe("unlock API replay, expiry, and missing-field rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalNonceLedger.clear();
    clearIdempotencyCache();
  });

  it("rejects a replayed request (same token used twice)", async () => {
    const { buyer, promptId, challenge, signedMessage } = await setupUnlockFixture();

    // First request succeeds
    const first = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });
    expect(first.statusCode).toBe(200);

    // Second request with identical parameters — must be rejected as replay
    const second = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });
    expect(second.statusCode).toBe(400);
    expect(second.responseData.code).toBe(ErrorCode.TEMPORARY_FAILURE);
    expect(String(second.responseData.error)).toContain("already been processed");
  });

  it("rejects an expired challenge token", async () => {
    const buyer = Keypair.random();
    const promptId = "42";

    // Token issued in the past with a short TTL that has since expired
    const challenge = createChallengeToken(
      process.env.CHALLENGE_TOKEN_SECRET!,
      buyer.publicKey(),
      promptId,
      Date.now() - 60_000, // 1 minute ago
      1000,                 // 1 second TTL
    );

    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage: "does-not-matter-verification-fails-first",
    });

    expect(statusCode).toBe(400);
    expect(responseData.code).toBe(ErrorCode.CHALLENGE_EXPIRED);
    expect(String(responseData.error)).toContain("expired");
  });

  it("rejects request with missing token", async () => {
    const { buyer, promptId, signedMessage } = await setupUnlockFixture();

    const { statusCode, responseData } = await invokeUnlock({
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(statusCode).toBe(400);
    expect(responseData.code).toBe(ErrorCode.MISSING_FIELDS);
  });

  it("rejects request with missing address", async () => {
    const { promptId, challenge, signedMessage } = await setupUnlockFixture();

    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      signedMessage,
    });

    expect(statusCode).toBe(400);
    expect(responseData.code).toBe(ErrorCode.MISSING_FIELDS);
  });

  it("rejects request with missing signedMessage", async () => {
    const { buyer, promptId, challenge } = await setupUnlockFixture();

    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
    });

    expect(statusCode).toBe(400);
    expect(responseData.code).toBe(ErrorCode.MISSING_FIELDS);
  });

  it("stable error shape for replay (consistent code and message)", async () => {
    const { buyer, promptId, challenge, signedMessage } = await setupUnlockFixture();

    // First request — consume the nonce
    await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    // Replay
    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(statusCode).toBe(400);
    expect(responseData).toMatchObject({
      code: ErrorCode.TEMPORARY_FAILURE,
      error: "This unlock request has already been processed.",
    });
  });
});

describe("unlock API idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalNonceLedger.clear();
    clearIdempotencyCache();
  });

  it("returns cached result when the same idempotency key is reused with identical data", async () => {
    const { buyer, promptId, challenge, signedMessage, plaintext } =
      await setupUnlockFixture();
    const idempotencyKey = "retry-test-key-001";

    // First request with idempotency key
    const first = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
      idempotencyKey,
    });
    expect(first.statusCode).toBe(200);
    expect(first.responseData.plaintext).toBe(plaintext);

    // Second request with the same idempotency key and identical data
    const second = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
      idempotencyKey,
    });
    expect(second.statusCode).toBe(200);
    expect(second.responseData.plaintext).toBe(plaintext);

    // The handler should not have called the decrypt mock twice
    expect(decryptPromptCiphertextMock).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when the same idempotency key is reused with different request data", async () => {
    const { buyer, promptId, challenge, signedMessage } =
      await setupUnlockFixture();
    const idempotencyKey = "conflict-test-key-002";

    // First request with idempotency key
    const first = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
      idempotencyKey,
    });
    expect(first.statusCode).toBe(200);

    // Second request with the same key but different signedMessage
    const differentSig = Buffer.from(
      buyer.sign(Buffer.from("different-message", "utf8")),
    ).toString("base64");
    const second = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage: differentSig,
      idempotencyKey,
    });
    expect(second.statusCode).toBe(409);
    expect(second.responseData.code).toBe(ErrorCode.IDEMPOTENCY_CONFLICT);
  });

  it("does not apply idempotency when no key is provided (normal behaviour)", async () => {
    const { buyer, promptId, challenge, signedMessage } =
      await setupUnlockFixture();

    // Two requests without an idempotency key — second should be rejected by nonce replay
    const first = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });
    expect(first.statusCode).toBe(200);

    const second = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });
    expect(second.statusCode).toBe(400);
  });

  it("caches expired-challenge errors under the idempotency key", async () => {
    const buyer = Keypair.random();
    const promptId = "42";
    const idempotencyKey = "error-cache-key-003";

    const challenge = createChallengeToken(
      process.env.CHALLENGE_TOKEN_SECRET!,
      buyer.publicKey(),
      promptId,
      Date.now() - 60_000,
      1000,
    );

    // First request — fails with expired challenge
    const first = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage: "any-signature",
      idempotencyKey,
    });
    expect(first.statusCode).toBe(400);
    expect(first.responseData.code).toBe(ErrorCode.CHALLENGE_EXPIRED);

    // Second request with the same key — returns cached error without reprocessing
    const second = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage: "any-signature",
      idempotencyKey,
    });
    expect(second.statusCode).toBe(400);
    expect(second.responseData.code).toBe(ErrorCode.CHALLENGE_EXPIRED);
  });
});

describe("unlock API ledger state verification (#545)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalNonceLedger.clear();
    clearIdempotencyCache();
  });

  it("rejects access when ledger verification returns no_access", async () => {
    const { buyer, promptId, challenge, signedMessage } = await setupUnlockFixture();

    verifyEntitlementMock.mockResolvedValue({
      hasAccess: false,
      ledgerSequence: 123456,
      ledgerHash: "stale_hash",
      networkId: "testnet",
      contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      checkedAt: Date.now(),
    });

    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(statusCode).toBe(403);
    expect(responseData.code).toBe(ErrorCode.ACCESS_NOT_PURCHASED);
  });

  it("rejects access when ledger verification returns lagging/stale state", async () => {
    const { buyer, promptId, challenge, signedMessage } = await setupUnlockFixture();

    // Simulate an RPC node that is 20 ledgers behind — beyond max freshness threshold
    verifyEntitlementMock.mockResolvedValue({
      hasAccess: false,
      ledgerSequence: 100, // very old ledger
      ledgerHash: "lagging_hash",
      networkId: "testnet",
      contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      checkedAt: Date.now() - 120_000, // 2 minutes old
    });

    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(statusCode).toBe(403);
    expect(responseData.code).toBe(ErrorCode.ACCESS_NOT_PURCHASED);
  });

  it("rejects access on network ID mismatch (cross-network replay)", async () => {
    const { buyer, promptId, challenge, signedMessage } = await setupUnlockFixture();

    verifyEntitlementMock.mockResolvedValue({
      hasAccess: false,
      ledgerSequence: 123456,
      ledgerHash: "wrong_network_hash",
      networkId: "wrong-network-id",
      contractId: "wrong-contract-id",
      checkedAt: Date.now(),
    });

    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(statusCode).toBe(403);
    expect(responseData.code).toBe(ErrorCode.ACCESS_NOT_PURCHASED);
  });

  it("denies access when RPC call throws (fail-closed on backend outage)", async () => {
    const { buyer, promptId, challenge, signedMessage } = await setupUnlockFixture();

    verifyEntitlementMock.mockRejectedValue(new Error("RPC node unreachable"));

    const { statusCode, responseData } = await invokeUnlock({
      token: challenge.token,
      promptId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(statusCode).toBe(403);
    expect(responseData.code).toBe(ErrorCode.ACCESS_NOT_PURCHASED);
  });
});
