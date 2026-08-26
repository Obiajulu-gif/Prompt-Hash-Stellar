import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyAuditTrail, hashWalletAddress, recordAuditEvent } from "../services/auditTrail";
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
});
