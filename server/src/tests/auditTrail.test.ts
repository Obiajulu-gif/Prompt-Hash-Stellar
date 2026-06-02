/**
 * Tests for the audit trail service and AuditLog model (Issue #145).
 *
 * Uses jest mocking so no live MongoDB connection is required.
 */

jest.mock("../models/AuditLog", () => {
  const mockCreate = jest.fn();
  const mockFind = jest.fn();

  const mockChain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  };
  mockFind.mockReturnValue(mockChain);

  return {
    AuditLog: {
      create: mockCreate,
      find: mockFind,
      __chain: mockChain,
    },
  };
});

import { AuditLog } from "../models/AuditLog";
import { recordAuditEvent, queryAuditEvents } from "../services/auditTrail";

const mockCreate = AuditLog.create as jest.MockedFunction<typeof AuditLog.create>;
const mockFind = AuditLog.find as jest.MockedFunction<typeof AuditLog.find>;
const mockChain = (AuditLog as any).__chain;

beforeEach(() => {
  jest.clearAllMocks();
  mockFind.mockReturnValue(mockChain);
  mockChain.sort.mockReturnValue(mockChain);
  mockChain.limit.mockReturnValue(mockChain);
  mockChain.lean.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// recordAuditEvent
// ---------------------------------------------------------------------------

describe("recordAuditEvent", () => {
  it("persists a challenge_issued event with all fields", async () => {
    mockCreate.mockResolvedValueOnce({} as never);

    await recordAuditEvent({
      action: "challenge_issued",
      result: "success",
      promptId: "42",
      walletAddress: "GABCDE",
      requestId: "req-001",
      clientIp: "127.0.0.1",
      reason: null,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      action: "challenge_issued",
      result: "success",
      promptId: "42",
      walletAddress: "gabcde", // lowercased
      requestId: "req-001",
      clientIp: "127.0.0.1",
      reason: null,
    });
  });

  it("persists an unlock_success event", async () => {
    mockCreate.mockResolvedValueOnce({} as never);

    await recordAuditEvent({
      action: "unlock_success",
      result: "success",
      promptId: "7",
      walletAddress: "GX123",
      requestId: "req-002",
      clientIp: "10.0.0.1",
      reason: null,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "unlock_success", result: "success" }),
    );
  });

  it("persists unlock_invalid_signature with reason code", async () => {
    mockCreate.mockResolvedValueOnce({} as never);

    await recordAuditEvent({
      action: "unlock_invalid_signature",
      result: "failure",
      promptId: "7",
      walletAddress: "GX123",
      requestId: "req-003",
      clientIp: "10.0.0.1",
      reason: "invalid_signature",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "unlock_invalid_signature",
        result: "failure",
        reason: "invalid_signature",
      }),
    );
  });

  it("persists unlock_expired_challenge with reason code", async () => {
    mockCreate.mockResolvedValueOnce({} as never);

    await recordAuditEvent({
      action: "unlock_expired_challenge",
      result: "failure",
      promptId: "7",
      walletAddress: "GX123",
      requestId: "req-004",
      clientIp: "10.0.0.1",
      reason: "expired_challenge",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "unlock_expired_challenge",
        reason: "expired_challenge",
      }),
    );
  });

  it("persists unlock_no_access with reason code", async () => {
    mockCreate.mockResolvedValueOnce({} as never);

    await recordAuditEvent({
      action: "unlock_no_access",
      result: "failure",
      promptId: "7",
      walletAddress: "GX123",
      requestId: "req-005",
      clientIp: "10.0.0.1",
      reason: "no_access",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "unlock_no_access", reason: "no_access" }),
    );
  });

  it("persists unlock_integrity_failure with reason code", async () => {
    mockCreate.mockResolvedValueOnce({} as never);

    await recordAuditEvent({
      action: "unlock_integrity_failure",
      result: "failure",
      promptId: "7",
      walletAddress: "GX123",
      requestId: "req-006",
      clientIp: "10.0.0.1",
      reason: "integrity_failure",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "unlock_integrity_failure",
        reason: "integrity_failure",
      }),
    );
  });

  it("persists unlock_rate_limited (blocked result)", async () => {
    mockCreate.mockResolvedValueOnce({} as never);

    await recordAuditEvent({
      action: "unlock_rate_limited",
      result: "blocked",
      promptId: null,
      walletAddress: null,
      requestId: null,
      clientIp: "10.0.0.1",
      reason: "ip_rate_limit_exceeded",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "unlock_rate_limited",
        result: "blocked",
        reason: "ip_rate_limit_exceeded",
      }),
    );
  });

  it("does not reject when DB write fails (fire-and-forget)", async () => {
    mockCreate.mockRejectedValueOnce(new Error("DB down"));

    // Should resolve without throwing.
    await expect(
      recordAuditEvent({
        action: "unlock_success",
        result: "success",
        promptId: "1",
        walletAddress: "GABC",
        requestId: null,
        clientIp: null,
        reason: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("does NOT store plaintext, keys, or signature fields", async () => {
    mockCreate.mockResolvedValueOnce({} as never);

    await recordAuditEvent({
      action: "unlock_success",
      result: "success",
      promptId: "1",
      walletAddress: "GABC",
      requestId: null,
      clientIp: null,
      reason: null,
      // Intentionally passing NO sensitive fields — the type signature enforces this.
    });

    const callArg = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("plaintext");
    expect(callArg).not.toHaveProperty("privateKey");
    expect(callArg).not.toHaveProperty("signedMessage");
    expect(callArg).not.toHaveProperty("challengeSecret");
    expect(callArg).not.toHaveProperty("encryptedPrompt");
  });
});

// ---------------------------------------------------------------------------
// queryAuditEvents
// ---------------------------------------------------------------------------

describe("queryAuditEvents", () => {
  it("queries by walletAddress (lowercased) and returns results", async () => {
    const fakeRecord = { action: "unlock_success", walletAddress: "gabcde" };
    mockChain.lean.mockResolvedValueOnce([fakeRecord]);

    const results = await queryAuditEvents({ walletAddress: "GABCDE" });

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: "gabcde" }),
    );
    expect(results).toEqual([fakeRecord]);
  });

  it("queries by promptId", async () => {
    mockChain.lean.mockResolvedValueOnce([]);

    await queryAuditEvents({ promptId: "42" });

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: "42" }),
    );
  });

  it("queries by action and result", async () => {
    mockChain.lean.mockResolvedValueOnce([]);

    await queryAuditEvents({ action: "unlock_no_access", result: "failure" });

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ action: "unlock_no_access", result: "failure" }),
    );
  });

  it("applies since/until date range", async () => {
    mockChain.lean.mockResolvedValueOnce([]);
    const since = new Date("2025-01-01");
    const until = new Date("2025-12-31");

    await queryAuditEvents({ since, until });

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAt: { $gte: since, $lte: until },
      }),
    );
  });

  it("respects custom limit", async () => {
    mockChain.lean.mockResolvedValueOnce([]);

    await queryAuditEvents({ limit: 25 });

    expect(mockChain.limit).toHaveBeenCalledWith(25);
  });

  it("defaults limit to 100", async () => {
    mockChain.lean.mockResolvedValueOnce([]);

    await queryAuditEvents({});

    expect(mockChain.limit).toHaveBeenCalledWith(100);
  });

  it("correlates records by requestId across wallet and promptId", async () => {
    const rec1 = { action: "challenge_issued", requestId: "req-x", walletAddress: "gx1" };
    const rec2 = { action: "unlock_success", requestId: "req-x", walletAddress: "gx1" };
    mockChain.lean.mockResolvedValueOnce([rec1, rec2]);

    const results = await queryAuditEvents({ walletAddress: "GX1" });

    expect(results).toHaveLength(2);
    expect(results[0].requestId).toBe("req-x");
    expect(results[1].requestId).toBe("req-x");
  });
});
