import { describe, expect, it } from "vitest";
import {
  getRetentionCutoff,
  isRetentionEligible,
  RETENTION_POLICIES,
} from "../jobs/retentionPolicy";
import { describe as describeRetentionEnforcement } from "vitest";

const NOW = new Date("2026-09-26T00:00:00.000Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe("retention policy selection", () => {
  it("defines the approved retention windows and preservation classes", () => {
    expect(RETENTION_POLICIES.promptEvents.retentionDays).toBe(30);
    expect(RETENTION_POLICIES.exports.retentionDays).toBe(30);
    expect(RETENTION_POLICIES.supportEvidence.retentionDays).toBe(365);
    expect(getRetentionCutoff("auditLogs", NOW)).toBeNull();
    expect(getRetentionCutoff("financialRecords", NOW)).toBeNull();
    expect(getRetentionCutoff("blockchainRecords", NOW)).toBeNull();
  });

  it("selects only successfully processed or terminal prompt events past cutoff", () => {
    expect(
      isRetentionEligible(
        "promptEvents",
        { processingStatus: "processed", createdAt: daysAgo(31) },
        NOW,
      ),
    ).toBe(true);
    expect(
      isRetentionEligible(
        "promptEvents",
        { status: "replayed", updatedAt: daysAgo(31) },
        NOW,
      ),
    ).toBe(true);
    expect(
      isRetentionEligible(
        "promptEvents",
        {
          status: "replayed",
          createdAt: daysAgo(90),
          updatedAt: daysAgo(10),
        },
        NOW,
      ),
    ).toBe(false);
    expect(
      isRetentionEligible(
        "promptEvents",
        { processingStatus: "failed", createdAt: daysAgo(90) },
        NOW,
      ),
    ).toBe(false);
    expect(
      isRetentionEligible(
        "promptEvents",
        { processingStatus: "processed", createdAt: daysAgo(30) },
        NOW,
      ),
    ).toBe(false);
  });

  it("selects terminal exports using completion time, never active jobs", () => {
    expect(
      isRetentionEligible(
        "exports",
        { status: "completed", completedAt: daysAgo(31) },
        NOW,
      ),
    ).toBe(true);
    expect(
      isRetentionEligible(
        "exports",
        { status: "dead_letter", updatedAt: daysAgo(31) },
        NOW,
      ),
    ).toBe(true);
    expect(
      isRetentionEligible(
        "exports",
        { status: "processing", completedAt: daysAgo(90) },
        NOW,
      ),
    ).toBe(false);
  });

  it("retains active support cases and selects closed cases after 365 days", () => {
    expect(
      isRetentionEligible(
        "supportEvidence",
        { status: "resolved", resolvedAt: daysAgo(366) },
        NOW,
      ),
    ).toBe(true);
    expect(
      isRetentionEligible(
        "supportEvidence",
        { status: "dismissed", updatedAt: daysAgo(366) },
        NOW,
      ),
    ).toBe(true);
    expect(
      isRetentionEligible(
        "supportEvidence",
        { status: "investigating", updatedAt: daysAgo(1000) },
        NOW,
      ),
    ).toBe(false);
  });

  it("never selects records on hold, already archived, or in protected classes", () => {
    const expiredEvent = {
      processingStatus: "processed",
      createdAt: daysAgo(60),
    };
    expect(
      isRetentionEligible(
        "promptEvents",
        { ...expiredEvent, retentionHold: true },
        NOW,
      ),
    ).toBe(false);
    expect(
      isRetentionEligible(
        "promptEvents",
        { ...expiredEvent, archivedAt: daysAgo(1) },
        NOW,
      ),
    ).toBe(false);
    expect(
      isRetentionEligible(
        "auditLogs",
        { status: "failure", createdAt: daysAgo(10000) },
        NOW,
      ),
    ).toBe(false);
    expect(
      isRetentionEligible(
        "financialRecords",
        { status: "settled", createdAt: daysAgo(10000) },
        NOW,
      ),
    ).toBe(false);
    expect(
      isRetentionEligible(
        "blockchainRecords",
        { status: "processed", createdAt: daysAgo(10000) },
        NOW,
      ),
    ).toBe(false);
  });

  it("does not treat invalid or missing dates as eligible", () => {
    expect(
      isRetentionEligible(
        "exports",
        { status: "completed", completedAt: "not-a-date" },
        NOW,
      ),
    ).toBe(false);
    expect(isRetentionEligible("exports", { status: "completed" }, NOW)).toBe(
      false,
    );
  });
});

describeRetentionEnforcement("retention enforcement and deletion verification", () => {
  it("enforces retention by deleting only eligible records and verifying deletion", async () => {
    const records = [
      { id: "eligible", processingStatus: "processed", createdAt: daysAgo(31) },
      { id: "recent", processingStatus: "processed", createdAt: daysAgo(10) },
      { id: "held", processingStatus: "processed", createdAt: daysAgo(60), retentionHold: true },
    ];
    const deleted: string[] = [];
    const store = {
      list: async () => records,
      delete: async (id: string) => {
        deleted.push(id);
      },
      exists: async (id: string) => !deleted.includes(id),
    };

    const { enforceRetention } = await import("../jobs/retentionPolicy");
    const result = await enforceRetention("promptEvents", store, NOW);

    expect(result.deletedIds).toEqual(["eligible"]);
    expect(result.verified).toBe(true);
    expect(deleted).toEqual(["eligible"]);
    expect(await store.exists("eligible")).toBe(false);
    expect(await store.exists("recent")).toBe(true);
    expect(await store.exists("held")).toBe(true);
  });

  it("retries transient deletion failures and reports unverified deletions", async () => {
    const records = [
      { id: "flaky", processingStatus: "processed", createdAt: daysAgo(31) },
    ];
    let attempts = 0;
    const store = {
      list: async () => records,
      delete: async () => {
        attempts += 1;
        if (attempts < 2) throw new Error("transient");
      },
      exists: async () => attempts < 2,
    };

    const { enforceRetention } = await import("../jobs/retentionPolicy");
    const result = await enforceRetention("promptEvents", store, NOW, {
      maxAttempts: 3,
    });

    expect(attempts).toBe(2);
    expect(result.deletedIds).toEqual(["flaky"]);
    expect(result.verified).toBe(true);
  });

  it("does not delete when authorization is missing", async () => {
    const records = [
      { id: "eligible", processingStatus: "processed", createdAt: daysAgo(31) },
    ];
    let deleted = false;
    const store = {
      list: async () => records,
      delete: async () => {
        deleted = true;
      },
      exists: async () => true,
    };

    const { enforceRetention } = await import("../jobs/retentionPolicy");
    await expect(
      enforceRetention("promptEvents", store, NOW, { authorized: false }),
    ).rejects.toThrow(/authoriz/i);
    expect(deleted).toBe(false);
  });

  it("preserves protected classes and reports no deletions", async () => {
    const store = {
      list: async () => [
        { id: "audit", status: "failure", createdAt: daysAgo(10000) },
      ],
      delete: async () => {
        throw new Error("should not delete");
      },
      exists: async () => true,
    };

    const { enforceRetention } = await import("../jobs/retentionPolicy");
    const result = await enforceRetention("auditLogs", store, NOW);

    expect(result.deletedIds).toEqual([]);
    expect(result.verified).toBe(true);
  });
});
