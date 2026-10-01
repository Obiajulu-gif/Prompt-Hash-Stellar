// @vitest-environment node

import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { createChallengeToken } from "../../src/lib/auth/challenge";
import { ErrorCode } from "../../src/lib/api/errorCodes";

vi.mock("../../src/lib/observability/wrapper", () => ({
  withObservability: (handler: unknown) => handler,
}));

vi.mock("../../src/lib/observability/replayProtection", () => ({
  checkReplayProtection: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock("../../src/lib/observability/metrics", () => ({
  metrics: {
    trackUnlockFailure: vi.fn(),
  },
}));

vi.mock("../../server/src/services/auditTrail", () => ({
  recordAuditEvent: vi.fn(),
}));

import handler from "./verify";

async function invokeVerify(body: Record<string, unknown>) {
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
  };

  // @ts-expect-error test handler invocation
  await handler(req, res);

  return { statusCode, responseData };
}

describe("wallet auth verify API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHALLENGE_TOKEN_SECRET = "integration-test-challenge-secret";
  });

  it("authenticates a wallet that signs the issued challenge", async () => {
    const wallet = Keypair.random();
    const promptId = "__wallet_sign_in__";
    const challenge = createChallengeToken(
      process.env.CHALLENGE_TOKEN_SECRET!,
      wallet.publicKey(),
      promptId,
    );
    const signedMessage = Buffer.from(
      wallet.sign(Buffer.from(challenge.challenge, "utf8")),
    ).toString("base64");

    const { statusCode, responseData } = await invokeVerify({
      address: wallet.publicKey(),
      token: challenge.token,
      signedMessage,
      promptId,
    });

    expect(statusCode).toBe(200);
    expect(responseData).toEqual({
      address: wallet.publicKey(),
      authenticated: true,
      expiresAt: expect.any(Number),
    });
  });

  it("rejects a signature from a different wallet", async () => {
    const wallet = Keypair.random();
    const attacker = Keypair.random();
    const promptId = "__wallet_sign_in__";
    const challenge = createChallengeToken(
      process.env.CHALLENGE_TOKEN_SECRET!,
      wallet.publicKey(),
      promptId,
    );
    const signedMessage = Buffer.from(
      attacker.sign(Buffer.from(challenge.challenge, "utf8")),
    ).toString("base64");

    const { statusCode, responseData } = await invokeVerify({
      address: wallet.publicKey(),
      token: challenge.token,
      signedMessage,
      promptId,
    });

    expect(statusCode).toBe(401);
    expect(responseData.code).toBe(ErrorCode.INVALID_SIGNATURE);
  });
});
