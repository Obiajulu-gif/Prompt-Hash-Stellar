/**
 * Schema compatibility tests for versioned contract event records (#1128).
 *
 * Prompt/Review documents (schemaVersioning.test.ts) and prompt metadata
 * (packages/schema compatibility.test.ts) already have compatibility suites.
 * Contract events are the remaining versioned record: they are emitted by
 * deployed contracts, retained forever in the indexer, and may arrive before
 * or after a consumer upgrade. These tests pin how each shape is classified.
 *
 * See docs/schema-compatibility.md#contract-event-records.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  SUPPORTED_VERSIONS,
  VERSION_METADATA,
  classifyEventRecord,
  detectEventVersion,
  detectEventVersionStrict,
  isBreakingTransition,
  validateEventStructure,
} from "../services/eventVersions.js";

const CREATOR = "GCREATOR000000000000000000000000000000000000000000000000";
const BUYER = "GBUYER00000000000000000000000000000000000000000000000000";
const ADMIN = "GADMIN00000000000000000000000000000000000000000000000000";
const ASSET = "CASSET00000000000000000000000000000000000000000000000000";

/**
 * Canonical retained record for every supported (type, version). A new
 * version in SUPPORTED_VERSIONS fails the coverage test below until a
 * fixture is added here — forcing a conscious compatibility review.
 */
const CANONICAL_RECORDS: Record<string, Record<number, Record<string, unknown>>> = {
  PromptCreated: { 1: { prompt_id: 7, creator: CREATOR, price_stroops: 25_000_000, asset: ASSET } },
  PromptPurchased: { 1: { prompt_id: 7, buyer: BUYER, creator: CREATOR, price_stroops: "25000000" } },
  PromptAdminModerated: {
    1: { prompt_id: 7, admin: ADMIN, status: "quarantined" },
    2: { version: 2, prompt_id: 7, admin: ADMIN, status: "quarantined", reason: "Spam", policy_reference: "POL-12" },
  },
  DisputeOpened: { 1: { prompt_id: 7, buyer: BUYER } },
  DisputeResolved: { 1: { prompt_id: 7, resolution: "refunded" } },
  PromptPriceUpdated: { 1: { prompt_id: 7, price_stroops: 30_000_000n } },
  LicenseTransferred: { 1: { prompt_id: 7, from: BUYER, to: CREATOR } },
  PromptTipped: { 1: { prompt_id: 7, amount: 1_000_000 } },
  VoucherAdded: { 1: { code_hash: "abc", discount_bps: 1_000 } },
  VoucherRemoved: { 1: { code_hash: "abc" } },
};

const without = (record: Record<string, unknown>, field: string) => {
  const copy = { ...record };
  delete copy[field];
  return copy;
};

describe("fixture coverage", () => {
  it("has a canonical record for every supported (event type, version)", () => {
    for (const [eventType, versions] of Object.entries(SUPPORTED_VERSIONS)) {
      for (const version of versions) {
        expect(CANONICAL_RECORDS[eventType]?.[version], `${eventType}@v${version}`).toBeDefined();
      }
    }
  });

  it("documents every non-initial version and marks additive versions non-breaking", () => {
    for (const [eventType, versions] of Object.entries(SUPPORTED_VERSIONS)) {
      for (const version of versions.filter((v) => v > 1)) {
        expect(VERSION_METADATA[eventType]?.[version], `${eventType}@v${version}`).toBeDefined();
      }
    }
    expect(isBreakingTransition("PromptAdminModerated", 1, 2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Normal path
// ---------------------------------------------------------------------------

describe("current consumer reading retained records", () => {
  const cases = Object.entries(CANONICAL_RECORDS).flatMap(([type, versions]) =>
    Object.entries(versions).map(([v, record]) => [type, Number(v), record] as const),
  );

  it.each(cases)("accepts %s v%i", (eventType, version, record) => {
    expect(classifyEventRecord(eventType, record)).toEqual({ disposition: "accept", eventType, version });
  });

  it("infers V1 for records that predate explicit versions", () => {
    expect(detectEventVersionStrict(CANONICAL_RECORDS.PromptCreated[1])).toEqual({ ok: true, version: 1 });
  });

  it("keeps reading V1 moderation records after V2 shipped (no backfill required)", () => {
    const v1 = CANONICAL_RECORDS.PromptAdminModerated[1];
    expect(v1).not.toHaveProperty("reason");
    expect(classifyEventRecord("PromptAdminModerated", v1).disposition).toBe("accept");
  });

  it("ignores unknown additive fields on a known version", () => {
    const record = { ...CANONICAL_RECORDS.PromptCreated[1], royalty_bps: 500, future_flag: true };
    expect(classifyEventRecord("PromptCreated", record).disposition).toBe("accept");
  });

  it("accepts every i128 encoding of price_stroops", () => {
    for (const price of [25_000_000, "25000000", 25_000_000n, 0]) {
      const record = { ...CANONICAL_RECORDS.PromptPurchased[1], price_stroops: price };
      expect(classifyEventRecord("PromptPurchased", record).disposition).toBe("accept");
    }
  });
});

// ---------------------------------------------------------------------------
// Failure path: incompatible shapes are quarantined, never coerced
// ---------------------------------------------------------------------------

describe("incompatible records are quarantined", () => {
  it.each(["prompt_id", "creator", "price_stroops", "asset"])(
    "PromptCreated without required field %s",
    (field) => {
      const result = classifyEventRecord("PromptCreated", without(CANONICAL_RECORDS.PromptCreated[1], field));
      expect(result).toMatchObject({ disposition: "quarantine", reason: "invalid_structure", retryAfterUpgrade: false });
      if (result.disposition === "quarantine") expect(result.errors.join()).toContain(field);
    },
  );

  it("renamed field (price_stroops -> price) is rejected", () => {
    const { price_stroops, ...rest } = CANONICAL_RECORDS.PromptPurchased[1];
    const result = classifyEventRecord("PromptPurchased", { ...rest, price: price_stroops });
    expect(result).toMatchObject({ disposition: "quarantine", reason: "invalid_structure" });
  });

  it.each([12.5, "12.5", "25e6", true, null, { amount: 1 }])(
    "type-changed price_stroops %j is rejected",
    (price) => {
      const record = { ...CANONICAL_RECORDS.PromptCreated[1], price_stroops: price };
      const result = classifyEventRecord("PromptCreated", record);
      expect(result).toMatchObject({ disposition: "quarantine", reason: "invalid_structure" });
    },
  );

  it("V2 moderation record missing its V2 fields is rejected", () => {
    const v2 = CANONICAL_RECORDS.PromptAdminModerated[2];
    for (const field of ["reason", "policy_reference"]) {
      expect(classifyEventRecord("PromptAdminModerated", without(v2, field))).toMatchObject({
        disposition: "quarantine",
        version: 2,
        reason: "invalid_structure",
      });
    }
  });

  it.each([null, undefined, "PromptCreated", 42, [1, 2]])("non-object payload %j is quarantined without throwing", (payload) => {
    expect(() => classifyEventRecord("PromptCreated", payload)).not.toThrow();
    expect(classifyEventRecord("PromptCreated", payload)).toMatchObject({
      disposition: "quarantine",
      reason: "invalid_payload",
    });
    expect(validateEventStructure("PromptCreated", 1, payload)).toEqual({
      valid: false,
      errors: ["Event payload must be an object"],
    });
  });

  it("unknown event types are quarantined and become retryable after an upgrade", () => {
    expect(classifyEventRecord("PromptBurned", { prompt_id: 1 })).toMatchObject({
      disposition: "quarantine",
      reason: "unknown_event_type",
      retryAfterUpgrade: true,
    });
  });
});

describe("malformed versions are never downgraded to V1", () => {
  it.each(["2", 0, -1, 1.5, Number.NaN, null, Infinity])("version %j", (version) => {
    const record = { ...CANONICAL_RECORDS.PromptAdminModerated[2], version };
    expect(detectEventVersionStrict(record)).toEqual({ ok: false, reason: "malformed_version" });
    expect(classifyEventRecord("PromptAdminModerated", record)).toMatchObject({
      disposition: "quarantine",
      reason: "malformed_version",
      retryAfterUpgrade: false,
    });
  });

  it("the legacy lenient detector is unchanged (contract preserved)", () => {
    // Documented hazard the strict detector exists to close.
    expect(detectEventVersion("PromptAdminModerated", { version: "2" })).toBe(1);
    expect(detectEventVersion("PromptAdminModerated", { version: 2 })).toBe(2);
    expect(detectEventVersion("PromptCreated", {})).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Retry path: old consumer vs new contract, then consumer upgrade
// ---------------------------------------------------------------------------

describe("forward compatibility and retry after consumer upgrade", () => {
  const original = [...SUPPORTED_VERSIONS.PromptPurchased];
  afterEach(() => {
    SUPPORTED_VERSIONS.PromptPurchased = [...original];
  });

  const v2Purchase = { ...CANONICAL_RECORDS.PromptPurchased[1], version: 2, referrer_bps: 250 };

  it("an old consumer quarantines a newer event version and flags it for retry", () => {
    expect(classifyEventRecord("PromptPurchased", v2Purchase)).toEqual({
      disposition: "quarantine",
      eventType: "PromptPurchased",
      version: 2,
      reason: "unsupported_version_2_requires_consumer_upgrade",
      retryAfterUpgrade: true,
      errors: ["Unsupported version 2 for event type PromptPurchased"],
    });
  });

  it("re-classifying the quarantined record after the consumer upgrade accepts it", () => {
    const quarantined = classifyEventRecord("PromptPurchased", v2Purchase);
    expect(quarantined.disposition).toBe("quarantine");

    SUPPORTED_VERSIONS.PromptPurchased = [1, 2]; // consumer deployed with V2 support
    expect(classifyEventRecord("PromptPurchased", v2Purchase)).toEqual({
      disposition: "accept",
      eventType: "PromptPurchased",
      version: 2,
    });
  });

  it("classification is pure: replaying the same record yields the same result", () => {
    const records = [v2Purchase, CANONICAL_RECORDS.PromptCreated[1], { version: "x" }, null];
    for (const record of records) {
      expect(classifyEventRecord("PromptPurchased", record)).toEqual(classifyEventRecord("PromptPurchased", record));
    }
  });

  it("rollback: dropping V2 support re-quarantines V2 records but keeps V1 readable", () => {
    SUPPORTED_VERSIONS.PromptPurchased = [1, 2];
    expect(classifyEventRecord("PromptPurchased", v2Purchase).disposition).toBe("accept");
    SUPPORTED_VERSIONS.PromptPurchased = [1]; // consumer rolled back
    expect(classifyEventRecord("PromptPurchased", v2Purchase).disposition).toBe("quarantine");
    expect(classifyEventRecord("PromptPurchased", CANONICAL_RECORDS.PromptPurchased[1]).disposition).toBe("accept");
  });

  it("a version older than any supported one is quarantined without an upgrade hint", () => {
    SUPPORTED_VERSIONS.PromptPurchased = [2, 3]; // V1 retired
    expect(classifyEventRecord("PromptPurchased", CANONICAL_RECORDS.PromptPurchased[1])).toMatchObject({
      disposition: "quarantine",
      reason: "unsupported_version_1",
      retryAfterUpgrade: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Authorization path: records that assert authority must name the actor
// ---------------------------------------------------------------------------

describe("authority-bearing records", () => {
  it.each([1, 2])("PromptAdminModerated v%i without an admin is never accepted", (version) => {
    const record = CANONICAL_RECORDS.PromptAdminModerated[version];
    for (const admin of [undefined, "", null]) {
      const result = classifyEventRecord("PromptAdminModerated", { ...record, admin });
      expect(result).toMatchObject({ disposition: "quarantine", reason: "invalid_structure" });
    }
  });

  it("PromptPurchased without buyer or creator cannot grant an entitlement", () => {
    for (const field of ["buyer", "creator"]) {
      const result = classifyEventRecord("PromptPurchased", without(CANONICAL_RECORDS.PromptPurchased[1], field));
      expect(result.disposition).toBe("quarantine");
    }
  });
});
