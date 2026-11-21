import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock DB connection
vi.mock("../db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/transferExecution", () => ({
  beginTransfer: vi.fn(),
  TransferCancelledError: class extends Error {},
}));

// Mock mongoose models
vi.mock("../models/Prompt", () => {
  const m = {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn(),
  };
  return { default: m };
});

vi.mock("../models/User", () => {
  const m = {
    findById: vi.fn(),
    findOne: vi.fn(),
    exec: vi.fn(),
  };
  return m;
});

vi.mock("../models/ExportRecord", () => {
  const m = {
    findById: vi.fn(),
    create: vi.fn(),
    find: vi.fn(),
    deleteMany: vi.fn(),
    countDocuments: vi.fn(),
  };
  return { ExportRecord: m };
});

vi.mock("../services/auditTrail", () => {
  const m = {
    hashWalletAddress: vi.fn(() => "wallet-fingerprint"),
  };
  return m;
});

import { EXPORT_SCOPES, EXPORT_RETENTION_MS, collectExportRecords, mayDownloadExport, type ExportScope } from "../services/exportService";
import Prompt from "../models/Prompt";
import { verifyExportChecksum } from "../services/exportService";

describe("Export Service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps owner-only digests and private lifecycle fields out of admin projections", async () => {
    const prompt = {
      _id: "prompt-1", owner: "wallet-address", contentHash: "integrity-digest",
      encryptedPrompt: "protected-content",
      lifecycleHistory: [{ to: "active", from: "draft", reason: "private-note" }],
    };
    const cursor = { async *[Symbol.asyncIterator]() { yield prompt; }, close: vi.fn() };
    const select = vi.fn(() => ({ sort: () => ({ lean: () => ({ cursor: () => cursor }) }) }));
    vi.mocked(Prompt.find).mockReturnValue({ select } as never);
    const admin = await collectExportRecords("owner", "full", false);
    const owner = await collectExportRecords("owner", "full", true);
    expect(select).toHaveBeenNthCalledWith(1, expect.not.stringContaining("contentHash"));
    expect(JSON.stringify(admin)).not.toMatch(/integrity-digest|protected-content|private-note|wallet-address/);
    expect(owner[0]).toHaveProperty("contentHash", "integrity-digest");
    expect(admin[1]).toMatchObject({ event: "active", result: "draft" });
    expect(cursor.close).toHaveBeenCalledTimes(2);
  });

  it("limits owner-created downloads to the owner and denies incomplete provenance", () => {
    const selfExport = { userId: "owner", auditTrail: { performedBy: "owner" } };
    expect(mayDownloadExport(selfExport, "owner")).toBe(true);
    expect(mayDownloadExport(selfExport, "other-admin")).toBe(false);
    expect(mayDownloadExport({ userId: "owner" }, "owner")).toBe(false);
  });

  describe("EXPORT_SCOPES", () => {
    it("should define all three export scopes", () => {
      const scopes: ExportScope[] = ["prompt", "history", "full"];
      for (const scope of scopes) {
        expect(Object.values(EXPORT_SCOPES)).toContain(scope);
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
      const hash = createHash("sha256");
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