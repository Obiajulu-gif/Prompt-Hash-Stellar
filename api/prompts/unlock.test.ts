// @vitest-environment node

import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  buildChallengeMessage,
  createChallengeToken,
} from "../../src/lib/auth/challenge";
import { ErrorCode } from "../../src/lib/api/errorCodes";

const hasAccessMock = vi.fn();
const getPromptMock = vi.fn();
const unwrapPromptKeyMock = vi.fn();
const decryptPromptCiphertextMock = vi.fn();
const hashPromptPlaintextMock = vi.fn();

vi.mock("../../src/lib/stellar/promptHashClient", () => ({
  hasAccess: (...args: unknown[]) => hasAccessMock(...args),
  getPrompt: (...args: unknown[]) => getPromptMock(...args),
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

async function setupUnlockFixture(plaintext = "Secret prompt instructions for buyers.") {
  const buyer = Keypair.random();
  const contentHash = "a".repeat(64);

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
      expiresAt: 1_700_000_000_000,
    };

    expect(buildChallengeMessage(payload)).toBe(
      "prompt-hash unlock:GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789:7:nonce-123:1700000000000",
    );
  });
});
