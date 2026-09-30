import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock DB connection
vi.mock("../db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(true),
}));

// Mock mongoose models
vi.mock("../models/Prompt", () => {
  const m: any = {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn(),
  };
  return m;
});

vi.mock("../models/User", () => {
  const m: any = {
    findById: vi.fn(),
    findOne: vi.fn(),
    exec: vi.fn(),
  };
  return m;
});

vi.mock("../models/ExportRecord", () => {
  const m: any = {
    findById: vi.fn(),
    create: vi.fn(),
    find: vi.fn(),
    deleteMany: vi.fn(),
    countDocuments: vi.fn(),
  };
  return m;
});

vi.mock("../services/auditTrail", () => {
  const m: any = {
    hashWalletAddress: vi.fn((addr: string) => `0x${addr.slice(-16)}`),
  };
  return m;
});

import { EXPORT_SCOPES, EXPORT_RETENTION_MS } from "../services/exportService";
import { verifyExportChecksum } from "../services/exportService";

describe("Export Service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("EXPORT_SCOPES", () => {
    it("should define all three export scopes", () => {
      const scopes: ExportScope[] = ["prompt", "history", "full"];
      for (const scope of scopes) {
        expect(EXPORT_SCOPES).toHaveProperty(scope);
      }
    });

    it("scope values are valid strings", () => {
      expect(EXPORT_SCOPES.PROMPT).toBe("prompt");
      expect(EXPORT_SCOPES.HISTORY).toBe("history");
      expect(EXPORT_SCOPES.FULL).toBe("full");
    });
  });

  describe("EXPORT_RETENTION_MS", () => {
    it("should be 24 hours in milliseconds", () => {
      const hours24 = 24 * 60 * 60 * 1000;
      expect(EXPORT_RETENTION_MS).toBe(hours24);
    });
  });

  describe("verifyExportChecksum", () => {
    it("should return true for matching checksums", () => {
      const records = [
        { id: "1", title: "Test" },
        { id: "2", title: "Test 2" },
      ];
      // Generate a checksum
      const hash = require("crypto").createHash("sha256");
      for (const r of records) {
        hash.update(JSON.stringify(r));
        hash.update("\n");
      }
      const checksum = hash.digest("hex");

      expect(verifyExportChecksum(records, checksum)).toBe(true);
    });

    it("should return false for mismatched checksums", () => {
      const records = [
        { id: "1", title: "Test" },
      ];
      expect(verifyExportChecksum(records, "0000000000000000000000000000000000000000000000000000000000000000")).toBe(
        false,
      );
    });

    it("should handle empty records array", () => {
      expect(verifyExportChecksum([], "any-checksum")).toBe(false);
    });
  });
});