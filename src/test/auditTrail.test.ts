/**
 * Tests for the audit trail service and AuditLog model (Issue #145).
 *
 * Mocks the AuditLog model so no live MongoDB connection is required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock AuditLog model before importing the service under test
// ---------------------------------------------------------------------------
const { mockCreate, mockLean, mockLimit, mockSort, mockFind } = vi.hoisted(() => {
  const mLean = vi.fn();
  const mLimit = vi.fn(() => ({ lean: mLean }));
  const mSort = vi.fn(() => ({ limit: mLimit }));
  const mFind = vi.fn(() => ({ sort: mSort }));
  return {
    mockCreate: vi.fn(),
    mockLean: mLean,
    mockLimit: mLimit,
    mockSort: mSort,
    mockFind: mFind,
  };
});

vi.mock("../../server/src/models/AuditLog", () => ({
  AuditLog: {
    create: mockCreate,
    find: mockFind,
  },
}));

import { recordAuditEvent, queryAuditEvents } from "../../server/src/services/auditTrail";

beforeEach(() => {
  vi.clearAllMocks();
  mockFind.mockReturnValue({ sort: mockSort });
  mockSort.mockReturnValue({ limit: mockLimit });
  mockLimit.mockReturnValue({ lean: mockLean });
  mockLean.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// recordAuditEvent — success paths
// ---------------------------------------------------------------------------

describe("recordAuditEvent – success paths", () => {
  it("persists challenge_issued with all fields, lowercasing the wallet", async () => {
    mockCreate.mockResolvedValueOnce({});

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
      walletAddress: "gabcde",
      requestId: "req-001",
      clientIp: "127.0.0.1",
      reason: null,
    });
  });

  it("persists unlock_success", async () => {
    mockCreate.mockResolvedValueOnce({});

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
});

// ---------------------------------------------------------------------------
// recordAuditEvent — failure reason codes
// ---------------------------------------------------------------------------

describe("recordAuditEvent – failure reason codes", () => {
  const failureCases: Array<{ action: Parameters<typeof recordAuditEvent>[0]["action"]; reason: string }> = [
    { action: "unlock_invalid_signature", reason: "invalid_signature" },
    { action: "unlock_expired_challenge", reason: "expired_challenge" },
    { action: "unlock_no_access", reason: "no_access" },
    { action: "unlock_integrity_failure", reason: "integrity_failure" },
    { action: "unlock_error", reason: "error" },
  ];

  for (const { action, reason } of failureCases) {
    it(`persists ${action} with reason=${reason}`, async () => {
      mockCreate.mockResolvedValueOnce({});

      await recordAuditEvent({
        action,
        result: "failure",
        promptId: "7",
        walletAddress: "GX123",
        requestId: "req-fail",
        clientIp: "10.0.0.1",
        reason,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ action, result: "failure", reason }),
      );
    });
  }
});

// ---------------------------------------------------------------------------
// recordAuditEvent — blocked / rate-limited
// ---------------------------------------------------------------------------

describe("recordAuditEvent – rate-limited (blocked)", () => {
  it("persists challenge_rate_limited with blocked result", async () => {
    mockCreate.mockResolvedValueOnce({});

    await recordAuditEvent({
      action: "challenge_rate_limited",
      result: "blocked",
      promptId: null,
      walletAddress: null,
      requestId: null,
      clientIp: "10.0.0.1",
      reason: "rate_limit_exceeded",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "challenge_rate_limited", result: "blocked" }),
    );
  });

  it("persists unlock_rate_limited for IP bucket", async () => {
    mockCreate.mockResolvedValueOnce({});

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
      expect.objectContaining({ reason: "ip_rate_limit_exceeded" }),
    );
  });

  it("persists unlock_rate_limited for wallet bucket", async () => {
    mockCreate.mockResolvedValueOnce({});

    await recordAuditEvent({
      action: "unlock_rate_limited",
      result: "blocked",
      promptId: "3",
      walletAddress: "GWALLET",
      requestId: "req-rl",
      clientIp: "10.0.0.1",
      reason: "wallet_rate_limit_exceeded",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "wallet_rate_limit_exceeded" }),
    );
  });
});

// ---------------------------------------------------------------------------
// recordAuditEvent — resilience
// ---------------------------------------------------------------------------

describe("recordAuditEvent – resilience", () => {
  it("does not throw when DB write fails (fire-and-forget)", async () => {
    mockCreate.mockRejectedValueOnce(new Error("DB down"));

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

  it("does NOT store sensitive fields (plaintext, keys, signatures)", async () => {
    mockCreate.mockResolvedValueOnce({});

    await recordAuditEvent({
      action: "unlock_success",
      result: "success",
      promptId: "1",
      walletAddress: "GABC",
      requestId: null,
      clientIp: null,
      reason: null,
    });

    const callArg = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("plaintext");
    expect(callArg).not.toHaveProperty("privateKey");
    expect(callArg).not.toHaveProperty("signedMessage");
    expect(callArg).not.toHaveProperty("challengeSecret");
    expect(callArg).not.toHaveProperty("encryptedPrompt");
    expect(callArg).not.toHaveProperty("wrappedKey");
  });
});

// ---------------------------------------------------------------------------
// queryAuditEvents
// ---------------------------------------------------------------------------

describe("queryAuditEvents", () => {
  it("queries by walletAddress (lowercased)", async () => {
    const record = { action: "unlock_success", walletAddress: "gabcde" };
    mockLean.mockResolvedValueOnce([record]);

    const results = await queryAuditEvents({ walletAddress: "GABCDE" });

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: "gabcde" }),
    );
    expect(results).toEqual([record]);
  });

  it("queries by promptId for incident correlation", async () => {
    mockLean.mockResolvedValueOnce([]);

    await queryAuditEvents({ promptId: "42" });

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: "42" }),
    );
  });

  it("queries by action and result", async () => {
    mockLean.mockResolvedValueOnce([]);

    await queryAuditEvents({ action: "unlock_no_access", result: "failure" });

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ action: "unlock_no_access", result: "failure" }),
    );
  });

  it("applies since/until date range", async () => {
    mockLean.mockResolvedValueOnce([]);
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
    mockLean.mockResolvedValueOnce([]);

    await queryAuditEvents({ limit: 25 });

    expect(mockLimit).toHaveBeenCalledWith(25);
  });

  it("defaults limit to 100", async () => {
    mockLean.mockResolvedValueOnce([]);

    await queryAuditEvents({});

    expect(mockLimit).toHaveBeenCalledWith(100);
  });

  it("correlates multiple events by requestId", async () => {
    const rec1 = { action: "challenge_issued", requestId: "req-x" };
    const rec2 = { action: "unlock_success", requestId: "req-x" };
    mockLean.mockResolvedValueOnce([rec1, rec2]);

    const results = await queryAuditEvents({ walletAddress: "GX1" });

    expect(results).toHaveLength(2);
    expect(results[0].requestId).toBe("req-x");
    expect(results[1].requestId).toBe("req-x");
  });
});
