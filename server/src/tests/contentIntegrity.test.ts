import crypto from "crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import Prompt from "../models/Prompt";
import {
  verifyPromptIntegrity,
  runContentIntegrityCheckAll,
} from "../services/contentIntegrity";

// Mock DB connection & Mongoose model for pure unit testing
vi.mock("../db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(true),
}));

describe("Content Integrity Service (#460)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return ok status when payload SHA-256 matches recorded contentHash", async () => {
    const payload = "encrypted-payload-sample-text";
    const hash = crypto.createHash("sha256").update(payload).digest("hex");

    const mockPrompt = {
      _id: "60d5ecb8b5c9c2419c8f0001",
      onChainId: "1",
      encryptedPrompt: payload,
      contentHash: hash,
      isActive: true,
      integrityStatus: "pending",
      integrityCheckedAt: null,
      integrityError: null,
      save: vi.fn().mockResolvedValue(true),
    };

    vi.spyOn(Prompt, "findOne").mockResolvedValue(mockPrompt as any);

    const result = await verifyPromptIntegrity("60d5ecb8b5c9c2419c8f0001");

    expect(result.status).toBe("ok");
    expect(result.computedHash).toBe(hash);
    expect(result.error).toBeNull();
    expect(mockPrompt.integrityStatus).toBe("ok");
    expect(mockPrompt.isActive).toBe(true); // Must not alter listing state
  });

  it("should detect corrupted payload when hash mismatches recorded contentHash", async () => {
    const originalPayload = "original-encrypted-data";
    const expectedHash = crypto.createHash("sha256").update(originalPayload).digest("hex");
    const tamperedPayload = "tampered-corrupted-data";

    const mockPrompt = {
      _id: "60d5ecb8b5c9c2419c8f0002",
      onChainId: "2",
      encryptedPrompt: tamperedPayload,
      contentHash: expectedHash,
      isActive: true,
      integrityStatus: "pending",
      integrityCheckedAt: null,
      integrityError: null,
      save: vi.fn().mockResolvedValue(true),
    };

    vi.spyOn(Prompt, "findOne").mockResolvedValue(mockPrompt as any);

    const result = await verifyPromptIntegrity("60d5ecb8b5c9c2419c8f0002");

    expect(result.status).toBe("corrupted");
    expect(result.error).toContain("Content hash mismatch");
    expect(mockPrompt.integrityStatus).toBe("corrupted");
    expect(mockPrompt.isActive).toBe(true); // Must remain untouched
  });

  it("should flag missing status when payload is empty or null", async () => {
    const mockPrompt = {
      _id: "60d5ecb8b5c9c2419c8f0003",
      encryptedPrompt: "",
      content: "",
      contentHash: "dummy-hash",
      isActive: true,
      integrityStatus: "pending",
      save: vi.fn().mockResolvedValue(true),
    };

    vi.spyOn(Prompt, "findOne").mockResolvedValue(mockPrompt as any);

    const result = await verifyPromptIntegrity("60d5ecb8b5c9c2419c8f0003");

    expect(result.status).toBe("missing");
    expect(result.error).toContain("missing or empty");
    expect(mockPrompt.integrityStatus).toBe("missing");
  });

  it("should return unreachable status if prompt does not exist in storage", async () => {
    vi.spyOn(Prompt, "findOne").mockResolvedValue(null);

    const result = await verifyPromptIntegrity("non-existent-id");

    expect(result.status).toBe("unreachable");
    expect(result.error).toContain("not found in storage");
  });

  it("should aggregate results cleanly in batch audit sweep", async () => {
    const p1 = {
      _id: "60d5ecb8b5c9c2419c8f0001",
      encryptedPrompt: "valid-1",
      contentHash: crypto.createHash("sha256").update("valid-1").digest("hex"),
      save: vi.fn().mockResolvedValue(true),
    };
    const p2 = {
      _id: "60d5ecb8b5c9c2419c8f0002",
      encryptedPrompt: "corrupted",
      contentHash: "wrong-hash",
      save: vi.fn().mockResolvedValue(true),
    };

    vi.spyOn(Prompt, "find").mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: p1._id }, { _id: p2._id }]),
      }),
    } as any);

    vi.spyOn(Prompt, "findOne")
      .mockResolvedValueOnce(p1 as any)
      .mockResolvedValueOnce(p2 as any);

    const report = await runContentIntegrityCheckAll();

    expect(report.totalChecked).toBe(2);
    expect(report.okCount).toBe(1);
    expect(report.corruptedCount).toBe(1);
    expect(report.failures.length).toBe(1);
    expect(report.failures[0].promptId).toBe(p2._id);
  });
});
