/**
 * Deterministic replay for concurrent writes and retries (#1008).
 *
 * The verifier folds the same journal under four delivery histories:
 * journal order, reversed arrival, a seeded concurrent interleaving, and a
 * retry storm with duplicate deliveries. The projection fingerprint must be
 * identical in every case. Failure, conflicting duplicates, and stale replay
 * of already-persisted rows are pinned as well.
 */

import { describe, expect, it } from "vitest";
import {
  DeterministicReplayError,
  fingerprintReplayRows,
  normalizeReplayBatch,
  replayDeterministically,
  verifyDeterministicReplay,
} from "../services/deterministicReplay";
import {
  promptListingProjection,
  type ReplayEvent,
} from "../services/projectionReplay";

function event(
  eventId: string,
  ledger: number,
  eventType: string,
  payload: Record<string, unknown>,
  eventVersion = 1,
): ReplayEvent {
  return { eventId, ledger, eventType, eventVersion, payload };
}

/**
 * Two prompts, a purchase, a price update, a sale-status change, an event the
 * projection ignores, and a purchase encoded with event schema v2.
 */
const JOURNAL: ReplayEvent[] = [
  event("evt-010-a", 10, "PromptCreated", {
    prompt_id: 1,
    creator: "GCREATOR1",
    asset: "CNATIVE",
    price_stroops: 10_000_000,
  }),
  event("evt-011-a", 11, "PromptCreated", {
    prompt_id: 2,
    creator: "GCREATOR2",
    asset: "CNATIVE",
    price_stroops: 5_000_000,
  }),
  event("evt-012-a", 12, "PromptPurchased", {
    prompt_id: 1,
    buyer: "GBUYER1",
    price_stroops: 10_000_000,
  }),
  event("evt-013-a", 13, "PromptPriceUpdated", {
    prompt_id: 1,
    price_stroops: 12_000_000,
  }),
  event("evt-014-a", 14, "PromptTipped", { prompt_id: 1, amount: 1 }),
  event("evt-015-a", 15, "PromptPurchased", {
    prompt_id: 1,
    buyer: "GBUYER2",
    price_stroops: 12_000_000,
  }, 2),
  event("evt-016-a", 16, "PromptSaleStatusUpdated", {
    prompt_id: 2,
    active: false,
  }),
];

const EXPECTED_PROMPT_1 = {
  promptId: "1",
  creator: "GCREATOR1",
  asset: "CNATIVE",
  priceStroops: "12000000",
  active: true,
  salesCount: 2,
  revenueStroops: "22000000",
  incomplete: false,
};

describe("deterministic replay fold", () => {
  it("normal path: folds the journal into the expected projection state", () => {
    const result = replayDeterministically(promptListingProjection, JOURNAL);

    expect(result.applied).toBe(6);
    expect(result.ignored).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.unsupported).toEqual([]);
    expect(result.rows.find((entry) => entry.key === "1")?.data).toEqual(EXPECTED_PROMPT_1);
    expect(result.rows.find((entry) => entry.key === "2")?.data).toMatchObject({
      active: false,
      salesCount: 0,
    });
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sorts by (ledger, eventId) rather than delivery order", () => {
    const shuffled = [JOURNAL[5], JOURNAL[2], JOURNAL[6], JOURNAL[0], JOURNAL[4], JOURNAL[1], JOURNAL[3]];
    const baseline = replayDeterministically(promptListingProjection, JOURNAL);
    const reordered = replayDeterministically(promptListingProjection, shuffled);

    expect(reordered.fingerprint).toBe(baseline.fingerprint);
    expect(reordered.rows).toEqual(baseline.rows);
  });

  it("collapses duplicate retries with identical bytes and counts them", () => {
    const retried = [...JOURNAL, ...JOURNAL, JOURNAL[2], JOURNAL[2]];
    const baseline = replayDeterministically(promptListingProjection, JOURNAL);
    const result = replayDeterministically(promptListingProjection, retried);

    expect(result.fingerprint).toBe(baseline.fingerprint);
    expect(result.duplicates).toBe(JOURNAL.length + 2);
    expect(result.applied).toBe(6);
  });

  it("rejects the same event id delivered with different bytes", () => {
    const tampered = [
      ...JOURNAL,
      event("evt-012-a", 12, "PromptPurchased", {
        prompt_id: 1,
        buyer: "GATTACKER",
        price_stroops: 1,
      }),
    ];

    expect(() => normalizeReplayBatch(tampered)).toThrowError(DeterministicReplayError);
    try {
      replayDeterministically(promptListingProjection, tampered);
    } catch (err) {
      expect((err as DeterministicReplayError).code).toBe("conflicting_event");
    }
  });

  it("skips already-persisted rows when a page is replayed after a crash", () => {
    const baseline = replayDeterministically(promptListingProjection, JOURNAL);
    const promptOne = baseline.rows.find((entry) => entry.key === "1")!;

    // Simulate rows written ahead of the checkpoint: event 13 (the price
    // update) is re-delivered, but the row already carries its effect.
    const result = replayDeterministically(promptListingProjection, JOURNAL, {
      initialRows: [promptOne],
    });

    expect(result.stale).toBeGreaterThan(0);
    expect(result.rows.find((entry) => entry.key === "1")?.data).toEqual(EXPECTED_PROMPT_1);
  });

  it("fails closed on an unsupported event version in strict mode", () => {
    const upgraded = [
      ...JOURNAL,
      event("evt-020-a", 20, "PromptPriceUpdated", { prompt_id: 2, price_stroops: 1 }, 3),
    ];

    expect(() => replayDeterministically(promptListingProjection, upgraded)).toThrowError(
      /unsupported_version: PromptPriceUpdated v3 at ledger 20/,
    );
  });

  it("reports unsupported events in lenient mode without applying them", () => {
    const upgraded = [
      ...JOURNAL,
      event("evt-020-a", 20, "PromptPriceUpdated", { prompt_id: 2, price_stroops: 1 }, 3),
    ];
    const result = replayDeterministically(promptListingProjection, upgraded, { strict: false });

    expect(result.unsupported).toEqual([
      {
        eventId: "evt-020-a",
        ledger: 20,
        eventType: "PromptPriceUpdated",
        eventVersion: 3,
        supportedVersions: [1, 2],
      },
    ]);
    expect(result.applied).toBe(6);
  });

  it("rejects malformed events before touching projection state", () => {
    const malformed = [
      JOURNAL[0],
      { ...JOURNAL[1], ledger: 1.5 } as unknown as ReplayEvent,
    ];

    expect(() => replayDeterministically(promptListingProjection, malformed)).toThrowError(
      /Malformed replay event/,
    );
  });
});

describe("deterministic replay verification", () => {
  it("produces the same fingerprint for journal, reverse, concurrent shuffle and retry storm", () => {
    const verification = verifyDeterministicReplay(promptListingProjection, JOURNAL);

    expect(verification.deterministic).toBe(true);
    expect(verification.mismatches).toEqual([]);
    expect(verification.runs.map((run) => run.order)).toEqual([
      "journal",
      "reverse",
      "seeded_shuffle",
      "retry_storm",
    ]);
    expect(new Set(verification.runs.map((run) => run.fingerprint))).toEqual(
      new Set([verification.fingerprint]),
    );
  });

  it("is stable across seeds and repeated invocations", () => {
    const first = verifyDeterministicReplay(promptListingProjection, JOURNAL, { seed: 7 });
    const second = verifyDeterministicReplay(promptListingProjection, JOURNAL, { seed: 7 });
    const otherSeed = verifyDeterministicReplay(promptListingProjection, JOURNAL, { seed: 99 });

    expect(second).toEqual(first);
    expect(otherSeed.fingerprint).toBe(first.fingerprint);
    expect(otherSeed.deterministic).toBe(true);
  });

  it("returns a stable fingerprint helper independent of row order", () => {
    const rows = replayDeterministically(promptListingProjection, JOURNAL).rows;
    expect(fingerprintReplayRows([...rows].reverse())).toBe(fingerprintReplayRows(rows));
  });
});
