import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildUnlockSupportTimelineFromRows,
  verifyAuditTrail,
  hashWalletAddress,
  recordAuditEvent,
  exportAuditBundle,
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

  describe("exportAuditBundle", () => {
    beforeEach(async () => {
      await AuditLog.deleteMany({});
    });

    afterEach(async () => {
      await AuditLog.deleteMany({});
    });

    it("exports filtered audit records by actor (wallet)", async () => {
      const wallet1 = "GDXSEH3V6V7K4J3L5M6N";
      const wallet2 = "GANOTHERWALLETADDRESS";

      await AuditLog.create([
        {
          action: "unlock_success",
          result: "success",
          promptId: "42",
          walletAddress: hashWalletAddress(wallet1),
          requestId: "req-1",
          recordHash: "a".repeat(64),
          previousHash: "0".repeat(64),
        },
        {
          action: "unlock_success",
          result: "success",
          promptId: "42",
          walletAddress: hashWalletAddress(wallet2),
          requestId: "req-2",
          recordHash: "b".repeat(64),
          previousHash: "a".repeat(64),
        },
      ]);

      const bundle = await exportAuditBundle({ actor: wallet1 });

      expect(bundle.recordCount).toBe(1);
      expect(bundle.records[0].walletHash).toBe(hashWalletAddress(wallet1));
      expect(bundle.records).not.toContainEqual(
        expect.objectContaining({ walletHash: hashWalletAddress(wallet2) })
      );
    });

    it("exports filtered audit records by promptId", async () => {
      await AuditLog.create([
        {
          action: "unlock_success",
          result: "success",
          promptId: "42",
          walletAddress: hashWalletAddress("GDXSEH3V6V7K4J3L5M6N"),
          requestId: "req-1",
          recordHash: "a".repeat(64),
          previousHash: "0".repeat(64),
        },
        {
          action: "unlock_success",
          result: "success",
          promptId: "99",
          walletAddress: hashWalletAddress("GANOTHERWALLETADDRESS"),
          requestId: "req-2",
          recordHash: "b".repeat(64),
          previousHash: "a".repeat(64),
        },
      ]);

      const bundle = await exportAuditBundle({ promptId: "42" });

      expect(bundle.recordCount).toBe(1);
      expect(bundle.records[0].promptId).toBe("42");
    });

    it("exports filtered audit records by date range", async () => {
      const since = new Date("2026-01-01T00:00:00.000Z");
      const until = new Date("2026-01-01T01:00:00.000Z");

      await AuditLog.create([
        {
          action: "unlock_success",
          result: "success",
          promptId: "42",
          walletAddress: hashWalletAddress("GDXSEH3V6V7K4J3L5M6N"),
          requestId: "req-1",
          createdAt: new Date("2026-01-01T00:30:00.000Z"),
          recordHash: "a".repeat(64),
          previousHash: "0".repeat(64),
        },
        {
          action: "unlock_success",
          result: "success",
          promptId: "42",
          walletAddress: hashWalletAddress("GANOTHERWALLETADDRESS"),
          requestId: "req-2",
          createdAt: new Date("2026-01-01T02:00:00.000Z"),
          recordHash: "b".repeat(64),
          previousHash: "a".repeat(64),
        },
      ]);

      const bundle = await exportAuditBundle({ since, until });

      expect(bundle.recordCount).toBe(1);
      expect(bundle.records[0].createdAt).toContain("00:30");
    });

    it("includes integrity checksum for export verification", async () => {
      await AuditLog.create({
        action: "unlock_success",
        result: "success",
        promptId: "42",
        walletAddress: hashWalletAddress("GDXSEH3V6V7K4J3L5M6N"),
        requestId: "req-1",
        recordHash: "a".repeat(64),
        previousHash: "0".repeat(64),
      });

      const bundle = await exportAuditBundle({});

      expect(bundle.integrityChecksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it("redacts actor filter in export metadata", async () => {
      await AuditLog.create({
        action: "unlock_success",
        result: "success",
        promptId: "42",
        walletAddress: hashWalletAddress("GDXSEH3V6V7K4J3L5M6N"),
        requestId: "req-1",
        recordHash: "a".repeat(64),
        previousHash: "0".repeat(64),
      });

      const bundle = await exportAuditBundle({ actor: "GDXSEH3V6V7K4J3L5M6N" });

      expect(bundle.filters.actor).toBe("[REDACTED_HASH]");
      expect(bundle.filters.promptId).toBe("42");
    });
  });
});
