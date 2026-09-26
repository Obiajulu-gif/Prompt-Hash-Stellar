import { describe, expect, it } from "vitest";
import {
  getRetentionCutoff,
  isRetentionEligible,
  RETENTION_POLICIES,
} from "../jobs/retentionPolicy";

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
