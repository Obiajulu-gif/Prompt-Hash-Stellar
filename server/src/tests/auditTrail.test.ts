import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildUnlockSupportTimelineFromRows,
  verifyAuditTrail,
  hashWalletAddress,
  recordAuditEvent,
} from "../services/auditTrail";
import { AuditLog } from "../models/AuditLog";

describe("auditTrail", () => {
  describe("hashWalletAddress", () => {
    it("returns a consistent hash for the same address", () => {
      const hash1 = hashWalletAddress("GDXSEH3V6V7K4J3L5M6N");
      const hash2 = hashWalletAddress("GDXSEH3V6V7K4J3L5M6N");
      expect(hash1).toBe(hash2);
    });

    it("normalizes address to lowercase before hashing", () => {
      const hash1 = hashWalletAddress("GDXSEH3V6V7K4J3L5M6N");
      const hash2 = hashWalletAddress("gdxseh3v6v7k4j3l5m6n");
      expect(hash1).toBe(hash2);
    });

    it("returns a 64-character hex string", () => {
      const hash = hashWalletAddress("GDXSEH3V6V7K4J3L5M6N");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("verifyAuditTrail", () => {
    beforeEach(async () => {
      await AuditLog.deleteMany({});
    });

    afterEach(async () => {
      await AuditLog.deleteMany({});
    });

    it("returns valid for empty audit trail", async () => {
      const result = await verifyAuditTrail();
      expect(result.valid).toBe(true);
      expect(result.totalRecords).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("detects valid chain with single record", async () => {
      await AuditLog.create({
        action: "unlock_success",
        result: "success",
        recordHash: "a".repeat(64),
        previousHash: "0".repeat(64),
      });

      const result = await verifyAuditTrail();
      expect(result.totalRecords).toBe(1);
    });
  });

  describe("buildUnlockSupportTimelineFromRows", () => {
    it("exports a deterministic redacted support timeline for unlock disputes", () => {
      const walletAddress = "GDXSEH3V6V7K4J3L5M6N";
      const walletHash = hashWalletAddress(walletAddress);
      const timeline = buildUnlockSupportTimelineFromRows(
        [
          {
            createdAt: new Date("2026-01-01T00:02:00.000Z"),
            action: "unlock_success",
            result: "success",
            promptId: "42",
            walletAddress: walletHash,
            requestId: "req-2",
            reason: null,
            recordHash: "b".repeat(64),
            previousHash: "a".repeat(64),
          },
          {
            createdAt: new Date("2026-01-01T00:01:00.000Z"),
            action: "challenge_issued",
            result: "success",
            promptId: "42",
            walletAddress: walletHash,
            requestId: "req-1",
            reason: null,
            recordHash: "a".repeat(64),
            previousHash: "0".repeat(64),
          },
        ],
        { walletAddress, promptId: "42" },
      );

      expect(timeline.walletHash).toBe(walletHash);
      expect(timeline.decision).toBe("allowed");
      expect(timeline.entries.map((entry) => entry.sequence)).toEqual([1, 2]);
      expect(JSON.stringify(timeline)).not.toContain(walletAddress);
    });
  });
});
