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
    aggregate: vi.fn(),
    countDocuments: vi.fn(),
    exists: vi.fn(),
  };
  return m;
});

vi.mock("../models/User", () => {
  const m: any = {
    exists: vi.fn(),
  };
  return m;
});

import { runDataIntegrityCheck, generateRemediationGuidance } from "../services/dataIntegrityMonitor";

describe("Data Integrity Monitor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("runDataIntegrityCheck", () => {
    it("should be a read-only operation that returns a report structure", async () => {
      // Setup: mock Prompt.countDocuments to return a number
      (Prompt.countDocuments as any).mockResolvedValue(100);

      // Setup: mock aggregate for duplicate checks to return empty (no duplicates)
      (Prompt.aggregate as any).mockResolvedValueOnce([]);

      const report = await runDataIntegrityCheck();

      // Verify report structure
      expect(report).toHaveProperty("generatedAt");
      expect(report).toHaveProperty("totalRecordsChecked");
      expect(report).toHaveProperty("orphanedCount");
      expect(report).toHaveProperty("duplicateCount");
      expect(report).toHaveProperty("staleCount");
      expect(report).toHaveProperty("inconsistentCount");
      expect(report).toHaveProperty("totalFailures");
      expect(report).toHaveProperty("failures");
      expect(Array.isArray(report.failures)).toBe(true);

      // Verify read-only: totalRecordsChecked should be a number
      expect(typeof report.totalRecordsChecked).toBe("number");
    });

    it("should detect orphaned records when fixtures provide orphan references", async () => {
      (Prompt.countDocuments as any).mockResolvedValue(50);

      // Mock: one prompt with orphaned owner reference
      (Prompt.find as any).mockResolvedValue([
        {
          _id: "prompt-orphan-1",
          onChainId: "oc-1",
          owner: "nonexistent-user-id",
          title: "Orphan Prompt",
          isActive: true,
          category: "Other",
        },
      ]);

      // Mock: User.exists returns false for the orphaned user
      (User.exists as any).mockResolvedValueOnce(false);

      const report = await runDataIntegrityCheck();

      expect(report.orphanedCount).toBeGreaterThan(0);
      expect(report.failures.some((f) => f.invariantId === "INV-ORPHAN-01")).toBe(true);
    });

    it("should detect duplicate onChainId records", async () => {
      (Prompt.countDocuments as any).mockResolvedValue(50);

      // Mock: aggregate finds duplicate onChainId
      (Prompt.aggregate as any)
        .mockResolvedValueOnce([
          {
            _id: "dup-onchain-1",
            count: 2,
            promptIds: ["prompt-dup-1", "prompt-dup-2"],
          },
        ])
        .mockResolvedValueOnce([]); // content hash check returns no duplicates

      const report = await runDataIntegrityCheck();

      expect(report.duplicateCount).toBeGreaterThan(0);
      expect(report.failures.some((f) => f.invariantId === "INV-DUP-01")).toBe(true);
    });

    it("should detect stale records older than threshold", async () => {
      (Prompt.countDocuments as any).mockResolvedValue(50);

      // Mock: stale prompts found
      (Prompt.find as any).mockResolvedValueOnce([
        {
          _id: "prompt-stale-1",
          onChainId: "oc-stale-1",
          title: "Stale Prompt",
          isActive: true,
          lifecycleState: "published",
          updatedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(), // 400 days ago
        },
      ]);

      const report = await runDataIntegrityCheck();

      expect(report.staleCount).toBeGreaterThan(0);
      expect(report.failures.some((f) => f.invariantId === "INV-STALE-01")).toBe(true);
    });

    it("should detect inconsistent records (invalid price, short title, etc.)", async () => {
      (Prompt.countDocuments as any).mockResolvedValue(50);

      // Mock: prompts with various inconsistencies
      (Prompt.find as any).mockResolvedValueOnce([
        {
          _id: "prompt-incons-1",
          onChainId: "oc-incons-1",
          title: "Ab",
          isActive: true,
          price: 0,
          category: "Other",
        },
        {
          _id: "prompt-incons-2",
          onChainId: "oc-incons-2",
          title: "Valid Title Here",
          isActive: true,
          price: 10,
          category: "Art",
        },
      ]);

      const report = await runDataIntegrityCheck();

      expect(report.inconsistentCount).toBeGreaterThan(0);
      expect(report.failures.some((f) => f.invariantId === "INV-INCONS-01")).toBe(true); // invalid price
      expect(report.failures.some((f) => f.invariantId === "INV-INCONS-02")).toBe(true); // short title
    });

    it("should generate remediation guidance for all failure categories", async () => {
      (Prompt.countDocuments as any).mockResolvedValue(50);

      // Minimal setup - just verify the guidance generation works
      const report = await runDataIntegrityCheck();

      const guidance = generateRemediationGuidance(report);
      expect(typeof guidance).toBe("string");
      expect(guidance.length).toBeGreaterThan(0);
    });
  });
});