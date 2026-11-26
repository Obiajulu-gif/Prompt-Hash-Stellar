import { describe, expect, it } from "vitest";
import {
  sortMixedStatusRecords,
  paginateMixedStatusRecords,
  encodeDeterministicCursor,
  decodeDeterministicCursor,
  verifySortingInvariants,
  computeSortedSequenceFingerprint,
  DeterministicSortError,
  PROMPT_STATUS_PRECEDENCE,
  EVENT_STATUS_PRECEDENCE,
  sortStatusComponentsDeterministically,
  sortMaintenanceBannersDeterministically,
  sortOperationalAlertsDeterministically,
  sortEventListDeterministically,
  getStatusRank,
  SortableRecord,
} from "../services/deterministicSorting";
import { derivePublicStatus } from "../services/publicStatus";

const CURSOR_SECRET = "cursor-secret-key-99999999";

describe("Deterministic Sorting for Mixed-Status Records and Events (#1032)", () => {
  const mixedRecords: SortableRecord[] = [
    { id: "prompt-c", status: "retired", primaryKey: 1000, secondaryKey: 1 },
    { id: "prompt-a", status: "active", primaryKey: 1000, secondaryKey: 2 },
    { id: "prompt-b", status: "paused", primaryKey: 1000, secondaryKey: 1 },
    { id: "prompt-d", status: "active", primaryKey: 1000, secondaryKey: 1 },
    { id: "prompt-e", status: "pending", primaryKey: 900, secondaryKey: 1 },
    { id: "prompt-f", status: "quarantined", primaryKey: 1200, secondaryKey: 3 },
  ];

  it("sorts deterministically using primary key then status precedence and id tie-breaking", () => {
    const sorted = sortMixedStatusRecords(mixedRecords, {
      direction: "asc",
      groupByStatus: false,
    });

    // Lowest primaryKey (900) first: prompt-e
    expect(sorted[0].id).toBe("prompt-e");

    // Among primaryKey 1000:
    // prompt-a (active, rank 1), prompt-d (active, rank 1), prompt-b (paused, rank 3), prompt-c (retired, rank 6)
    // Between prompt-a and prompt-d (both rank 1): secondaryKey 1 < 2, so prompt-d (sec 1) before prompt-a (sec 2)
    expect(sorted[1].id).toBe("prompt-d");
    expect(sorted[2].id).toBe("prompt-a");
    expect(sorted[3].id).toBe("prompt-b");
    expect(sorted[4].id).toBe("prompt-c");

    // Highest primaryKey (1200): prompt-f
    expect(sorted[5].id).toBe("prompt-f");
  });

  it("sorts with dominant status grouping when groupByStatus is true", () => {
    const sorted = sortMixedStatusRecords(mixedRecords, {
      direction: "asc",
      groupByStatus: true,
    });

    // Active records first (rank 1): prompt-d (sec 1) then prompt-a (sec 2)
    expect(sorted[0].id).toBe("prompt-d");
    expect(sorted[1].id).toBe("prompt-a");

    // Pending next (rank 2): prompt-e
    expect(sorted[2].id).toBe("prompt-e");

    // Paused next (rank 3): prompt-b
    expect(sorted[3].id).toBe("prompt-b");

    // Quarantined next (rank 5): prompt-f
    expect(sorted[4].id).toBe("prompt-f");

    // Retired last (rank 6): prompt-c
    expect(sorted[5].id).toBe("prompt-c");
  });

  it("guarantees permutation invariance (identical sequence from reverse or shuffle)", () => {
    const input1 = [...mixedRecords];
    const input2 = [...mixedRecords].reverse();
    const input3 = [mixedRecords[2], mixedRecords[5], mixedRecords[0], mixedRecords[4], mixedRecords[1], mixedRecords[3]];

    const sorted1 = sortMixedStatusRecords(input1);
    const sorted2 = sortMixedStatusRecords(input2);
    const sorted3 = sortMixedStatusRecords(input3);

    const fp1 = computeSortedSequenceFingerprint(sorted1);
    const fp2 = computeSortedSequenceFingerprint(sorted2);
    const fp3 = computeSortedSequenceFingerprint(sorted3);

    expect(fp1).toBe(fp2);
    expect(fp2).toBe(fp3);
    expect(sorted1.map((r) => r.id)).toEqual(sorted2.map((r) => r.id));
    expect(sorted2.map((r) => r.id)).toEqual(sorted3.map((r) => r.id));
  });

  it("passes invariant verifier with zero violations", () => {
    const verification = verifySortingInvariants(mixedRecords, { groupByStatus: false });

    expect(verification.isTotalOrder).toBe(true);
    expect(verification.isPermutationInvariant).toBe(true);
    expect(verification.violations).toHaveLength(0);
    expect(verification.fingerprint).toBeDefined();
  });

  it("paginates deterministically without missing records or creating duplicates", () => {
    const allRecords: SortableRecord[] = Array.from({ length: 12 }, (_, i) => ({
      id: `p_${String(i).padStart(2, "0")}`,
      status: i % 2 === 0 ? "active" : "paused",
      primaryKey: 1000 + (i % 3) * 10,
      secondaryKey: i,
    }));

    const page1 = paginateMixedStatusRecords(allRecords, {
      limit: 5,
      secret: CURSOR_SECRET,
    });
    expect(page1.items).toHaveLength(5);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = paginateMixedStatusRecords(allRecords, {
      limit: 5,
      cursor: page1.nextCursor,
      secret: CURSOR_SECRET,
    });
    expect(page2.items).toHaveLength(5);
    expect(page2.hasMore).toBe(true);

    const page3 = paginateMixedStatusRecords(allRecords, {
      limit: 5,
      cursor: page2.nextCursor,
      secret: CURSOR_SECRET,
    });
    expect(page3.items).toHaveLength(2);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();

    // Verify union of pages contains all 12 unique items with 0 duplicates
    const combinedIds = [
      ...page1.items.map((i) => i.id),
      ...page2.items.map((i) => i.id),
      ...page3.items.map((i) => i.id),
    ];
    expect(combinedIds).toHaveLength(12);
    expect(new Set(combinedIds).size).toBe(12);
  });

  it("detects and rejects tampered pagination cursors", () => {
    const record: SortableRecord = { id: "p1", status: "active", primaryKey: 100 };
    const validCursor = encodeDeterministicCursor(record, CURSOR_SECRET);

    // Tamper with payload
    const [payload, sig] = validCursor.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ id: "p99", statusRank: 1, primaryKey: 999 })).toString("base64url");
    const tamperedCursor = `${tamperedPayload}.${sig}`;

    expect(() => decodeDeterministicCursor(tamperedCursor, CURSOR_SECRET)).toThrow(
      DeterministicSortError,
    );
    try {
      decodeDeterministicCursor(tamperedCursor, CURSOR_SECRET);
    } catch (err: any) {
      expect(err.code).toBe("cursor_tampered");
    }
  });

  it("supports event-specific status precedence ordering", () => {
    const events: SortableRecord[] = [
      { id: "e1", status: "quarantined", primaryKey: 500 },
      { id: "e2", status: "committed", primaryKey: 500 },
      { id: "e3", status: "replayed", primaryKey: 500 },
      { id: "e4", status: "dlq", primaryKey: 500 },
    ];

    const sorted = sortMixedStatusRecords(events, {
      groupByStatus: true,
      statusPrecedence: EVENT_STATUS_PRECEDENCE,
    });

    expect(sorted.map((e) => e.status)).toEqual([
      "committed",
      "replayed",
      "quarantined",
      "dlq",
    ]);
  });

  it("recovers cleanly when the cursor anchor item is deleted between pages (#1184)", () => {
    const records: SortableRecord[] = [
      { id: "e1", status: "committed", primaryKey: 100, secondaryKey: 1 },
      { id: "e2", status: "pending", primaryKey: 100, secondaryKey: 2 },
      { id: "e3", status: "quarantined", primaryKey: 100, secondaryKey: 3 },
      { id: "e4", status: "dlq", primaryKey: 200, secondaryKey: 1 },
    ];
    const page1 = paginateMixedStatusRecords(records, {
      limit: 2,
      secret: CURSOR_SECRET,
      sortOptions: { groupByStatus: true, statusPrecedence: EVENT_STATUS_PRECEDENCE },
    });
    expect(page1.items.map((r) => r.id)).toEqual(["e1", "e2"]);

    // Delete the cursor anchor ("e2") before fetching page 2
    const remaining = records.filter((r) => r.id !== "e2");
    const page2 = paginateMixedStatusRecords(remaining, {
      limit: 2,
      cursor: page1.nextCursor,
      secret: CURSOR_SECRET,
      sortOptions: { groupByStatus: true, statusPrecedence: EVENT_STATUS_PRECEDENCE },
    });
    expect(page2.items.map((r) => r.id)).toEqual(["e3", "e4"]);
    expect(page2.hasMore).toBe(false);
  });

  it("deterministically sorts status components, maintenance banners, operational alerts, and event lists (#1184)", () => {
    const components = [
      { name: "Horizon", status: "up" as const, latencyMs: 50 },
      { name: "Unlock Service", status: "degraded" as const, latencyMs: 900 },
      { name: "Database", status: "down" as const, latencyMs: null },
      { name: "Stellar RPC", status: "up" as const, latencyMs: 120 },
    ];
    const sortedForward = sortStatusComponentsDeterministically(components);
    const sortedReversed = sortStatusComponentsDeterministically([...components].reverse());
    expect(sortedForward.map((c) => c.name)).toEqual(["Database", "Unlock Service", "Stellar RPC", "Horizon"]);
    expect(sortedReversed.map((c) => c.name)).toEqual(sortedForward.map((c) => c.name));

    const banners = [
      { id: "b-info", severity: "info", endsAt: "2026-10-18T10:00:00.000Z" },
      { id: "b-crit-late", severity: "critical", endsAt: "2026-10-19T10:00:00.000Z" },
      { id: "b-crit-early", severity: "critical", endsAt: "2026-10-17T10:00:00.000Z" },
      { id: "b-warn", severity: "warning", endsAt: "2026-10-17T12:00:00.000Z" },
    ];
    expect(sortMaintenanceBannersDeterministically(banners).map((b) => b.id)).toEqual([
      "b-crit-early",
      "b-crit-late",
      "b-warn",
      "b-info",
    ]);

    // Public status integration with deterministicOrder: true
    const pub = derivePublicStatus({
      components,
      probes: [],
      maintenance: banners as any,
      contractPaused: false,
      deterministicOrder: true,
    });
    expect(pub.services.map((s) => s.name)).toEqual(["Database", "Unlock Service", "Stellar RPC", "Horizon"]);
    expect(pub.maintenance.map((m) => m.id)).toEqual(["b-crit-early", "b-crit-late", "b-warn", "b-info"]);

    // Operational alerts: severity first, then newest timestamp, then ID
    const alerts = [
      { id: "a-high-old", severity: "HIGH", occurredAt: "2026-10-17T08:00:00.000Z" },
      { id: "a-crit", severity: "CRITICAL", occurredAt: "2026-10-17T07:00:00.000Z" },
      { id: "a-high-b", severity: "HIGH", occurredAt: "2026-10-17T09:00:00.000Z" },
      { id: "a-high-a", severity: "HIGH", occurredAt: "2026-10-17T09:00:00.000Z" },
    ];
    expect(sortOperationalAlertsDeterministically(alerts).map((a) => a.id)).toEqual([
      "a-crit",
      "a-high-a",
      "a-high-b",
      "a-high-old",
    ]);

    // Event list sorting: permutation-invariant with tie-breaking by status, sequence, and ID
    const events = [
      { _id: "ev-b", processingStatus: "failed", createdAt: "2026-10-17T10:00:00.000Z", attemptCount: 1 },
      { _id: "ev-a", processingStatus: "failed", createdAt: "2026-10-17T10:00:00.000Z", attemptCount: 1 },
      { _id: "ev-c", processingStatus: "dead_letter", createdAt: "2026-10-17T10:00:00.000Z", attemptCount: 5 },
      { _id: "ev-d", processingStatus: "processed", createdAt: "2026-10-17T11:00:00.000Z", attemptCount: 1 },
    ];
    const evForward = sortEventListDeterministically(events, { direction: "desc" });
    const evReversed = sortEventListDeterministically([...events].reverse(), { direction: "desc" });
    expect(evForward.map((e) => e._id)).toEqual(["ev-d", "ev-c", "ev-b", "ev-a"]);
    expect(evReversed.map((e) => e._id)).toEqual(evForward.map((e) => e._id));
  });

  it("ignores Object.prototype keys when resolving status rank", () => {
    expect(getStatusRank("constructor")).toBe(999);
    expect(getStatusRank("toString")).toBe(999);
    expect(getStatusRank("__proto__")).toBe(999);
  });
});
