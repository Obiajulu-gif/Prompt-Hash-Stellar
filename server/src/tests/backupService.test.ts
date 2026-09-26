import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";
import { restoreBackup } from "../services/backupService";

// Mock DB connection & Mongoose models
vi.mock("mongoose", async () => {
  const actual: any = await vi.importActual("mongoose");
  return {
    ...actual,
    default: {
      ...actual.default,
      connection: {
        db: {
          collection: vi.fn(),
        },
      },
      models: {},
      model: vi.fn().mockReturnValue({
        create: vi.fn().mockResolvedValue({}),
        findOne: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(null),
          }),
        }),
      }),
    },
  };
});

describe("backupService - Backup & Restore Integrity (#607)", () => {
  const sampleDoc = { _id: "60d5ecb8b5c9c2419c8f0001", title: "Test Prompt", price: 100 };
  const ndjsonLine = JSON.stringify(sampleDoc) + "\n";
  const ndjsonBuf = Buffer.from(ndjsonLine, "utf8");
  const sha256 = crypto.createHash("sha256").update(ndjsonBuf).digest("hex");

  const validManifest = {
    version: "1.0.0" as const,
    timestamp: "2026-08-24T18-00-00-000Z",
    prefix: "backups",
    totalDocuments: 1,
    collections: {
      prompts: {
        name: "prompts",
        key: "backups/2026-08-24T18-00-00-000Z/prompts.ndjson.gz",
        docCount: 1,
        sha256,
        uncompressedBytes: ndjsonBuf.length,
        compressedBytes: ndjsonBuf.length,
      },
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("restoreBackup rejects live restore when confirm flag is missing", async () => {
    await expect(
      restoreBackup({
        manifest: validManifest,
        backupFiles: { prompts: ndjsonBuf },
        dryRun: false,
        confirm: false,
      }),
    ).rejects.toThrow(/Restore safety guard/);
  });

  it("restoreBackup verifies integrity in dry-run mode without modifying DB", async () => {
    const result = await restoreBackup({
      manifest: validManifest,
      backupFiles: { prompts: ndjsonBuf },
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.totalDocuments).toBe(1);
    expect(result.collections[0].sha256Verified).toBe(true);
    expect(result.collections[0].jsonValid).toBe(true);
    expect(result.message).toContain("integrity verified successfully");
  });

  it("restoreBackup rejects corrupted backup with checksum mismatch before modifying DB", async () => {
    const tamperedBuf = Buffer.from(JSON.stringify({ ...sampleDoc, price: 999 }) + "\n", "utf8");

    await expect(
      restoreBackup({
        manifest: validManifest,
        backupFiles: { prompts: tamperedBuf },
        dryRun: true,
      }),
    ).rejects.toThrow(/SHA-256 checksum mismatch/);
  });

  it("restoreBackup rejects corrupted NDJSON syntax before modifying DB", async () => {
    const invalidJsonBuf = Buffer.from("{ invalid json content }\n", "utf8");
    const invalidSha = crypto.createHash("sha256").update(invalidJsonBuf).digest("hex");

    const invalidManifest = {
      ...validManifest,
      collections: {
        prompts: {
          ...validManifest.collections.prompts,
          sha256: invalidSha,
        },
      },
    };

    await expect(
      restoreBackup({
        manifest: invalidManifest,
        backupFiles: { prompts: invalidJsonBuf },
        dryRun: true,
      }),
    ).rejects.toThrow(/Corrupted NDJSON/);
  });
});
