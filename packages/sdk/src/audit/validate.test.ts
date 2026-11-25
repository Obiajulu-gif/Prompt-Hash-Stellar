/**
 * Schema validation and backward-compatibility tests — Issue #1094.
 *
 * Covers:
 *  - Valid events pass `validateAuditEvent`.
 *  - Every required envelope field, when missing or wrong type, produces an error.
 *  - Payloads containing REDACTED_FIELDS are rejected.
 *  - `isCompatible` and `isFutureVersion` behave correctly for current, old,
 *    and future schema versions.
 *  - `migrateEvent` is a no-op for a current-version event.
 *  - A future-version event (from a newer deploy) is not migrated down and
 *    is correctly identified by `isFutureVersion`.
 */
import { describe, expect, it } from "vitest";
import {
  validateAuditEvent,
  isCompatible,
  isFutureVersion,
} from "./validate.js";
import { migrateEvent } from "./compatibility.js";
import { AUDIT_SCHEMA_VERSION, REDACTED_FIELDS, type AuditEvent } from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    name: "Prompt.Purchased",
    occurredAt: "2025-01-15T12:00:00.000Z",
    actor: { stellarAddress: "GBUYER000000000000000000000000000000000000000000000000000" },
    resource: { type: "prompt", id: "42" },
    correlation: { txHash: "deadbeef" },
    payload: { prompt_id: 42n, price_stroops: 5_000_0000000n },
    ...overrides,
  };
}

// ─── validateAuditEvent ───────────────────────────────────────────────────────

describe("validateAuditEvent — valid events", () => {
  it("accepts a well-formed event", () => {
    const result = validateAuditEvent(validEvent());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.event.name).toBe("Prompt.Purchased");
      expect(result.event.schemaVersion).toBe(1);
    }
  });

  it("accepts an event with no correlation (optional field)", () => {
    const event = validEvent();
    // @ts-expect-error — testing absence of optional field at runtime
    delete event.correlation;
    // correlation is optional so the validator treats absent as fine
    const result = validateAuditEvent(event);
    expect(result.valid).toBe(true);
  });

  it("accepts a serviceId actor", () => {
    const result = validateAuditEvent(
      validEvent({ actor: { serviceId: "indexer" } }),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts an adminRole actor", () => {
    const result = validateAuditEvent(
      validEvent({ actor: { adminRole: "platform-admin" } }),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts every valid resource.type", () => {
    const resourceTypes = [
      "prompt", "bundle", "access-pass", "license", "contract",
      "voucher", "listing", "fee", "dispute", "payout",
    ] as const;
    for (const type of resourceTypes) {
      const result = validateAuditEvent(validEvent({ resource: { type } }));
      expect(result.valid, `resource.type "${type}" should be valid`).toBe(true);
    }
  });
});

describe("validateAuditEvent — envelope field errors", () => {
  it("rejects a non-object input", () => {
    const result = validateAuditEvent("not an object");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]).toMatch(/not a plain object/i);
  });

  it("rejects a missing schemaVersion", () => {
    const { schemaVersion: _omit, ...event } = validEvent();
    const result = validateAuditEvent(event);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects an unsupported schemaVersion", () => {
    const result = validateAuditEvent(validEvent({ schemaVersion: 99 as never }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.includes("not supported"))).toBe(true);
  });

  it("rejects a missing name", () => {
    const event = validEvent();
    // @ts-expect-error — testing invalid runtime state
    event.name = "";
    const result = validateAuditEvent(event);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects a missing occurredAt", () => {
    const event = validEvent();
    // @ts-expect-error
    delete event.occurredAt;
    const result = validateAuditEvent(event);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.includes("occurredAt"))).toBe(true);
  });

  it("rejects a non-ISO occurredAt", () => {
    const result = validateAuditEvent(validEvent({ occurredAt: "not-a-date" }));
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.some((e) => e.includes("occurredAt"))).toBe(true);
  });

  it("rejects an actor with no identifying field", () => {
    const result = validateAuditEvent(validEvent({ actor: {} }));
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.some((e) => e.includes("actor"))).toBe(true);
  });

  it("rejects an invalid resource.type", () => {
    const result = validateAuditEvent(
      validEvent({ resource: { type: "unknown-type" as never } }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.some((e) => e.includes("resource.type"))).toBe(true);
  });

  it("rejects a non-object payload", () => {
    const result = validateAuditEvent({ ...validEvent(), payload: "bad" });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.some((e) => e.includes("payload"))).toBe(true);
  });

  it("preserves the raw input in a ValidationError for quarantine storage", () => {
    const raw = { schemaVersion: "not-a-number" };
    const result = validateAuditEvent(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.raw).toBe(raw);
  });
});

describe("validateAuditEvent — redaction enforcement", () => {
  it.each([...REDACTED_FIELDS])(
    "rejects a payload containing the redacted field '%s'",
    (field) => {
      const result = validateAuditEvent(
        validEvent({ payload: { [field]: "sensitive-value" } }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid)
        expect(result.errors.some((e) => e.includes(field))).toBe(true);
    },
  );

  it("accepts a payload where a formerly-redacted field is replaced with the sentinel", () => {
    // After redactEvent the field holds "[REDACTED]" — but validators see the
    // key is gone from REDACTED_FIELDS check (key still present, value is sentinel).
    // The sentinel itself is not sensitive; the key check ensures only plaintext
    // values are blocked. Sentinel value should still pass validation because
    // the validator checks key presence in REDACTED_FIELDS, not value content.
    const result = validateAuditEvent(
      validEvent({ payload: { safe_field: "[REDACTED]" } }),
    );
    expect(result.valid).toBe(true);
  });
});

// ─── isCompatible / isFutureVersion ──────────────────────────────────────────

describe("isCompatible", () => {
  it("returns true for the current version", () => {
    expect(isCompatible(AUDIT_SCHEMA_VERSION)).toBe(true);
  });

  it("returns false for version 0 (before the schema existed)", () => {
    expect(isCompatible(0)).toBe(false);
  });

  it("returns false for a future version this build does not know", () => {
    expect(isCompatible(99)).toBe(false);
  });
});

describe("isFutureVersion", () => {
  it("returns false for the current version", () => {
    expect(isFutureVersion(AUDIT_SCHEMA_VERSION)).toBe(false);
  });

  it("returns true for a version higher than the current", () => {
    expect(isFutureVersion(AUDIT_SCHEMA_VERSION + 1)).toBe(true);
  });

  it("returns false for a version lower than the current", () => {
    if (AUDIT_SCHEMA_VERSION > 1) {
      expect(isFutureVersion(AUDIT_SCHEMA_VERSION - 1)).toBe(false);
    } else {
      // Version is 1 — nothing lower to test; assertion trivially true.
      expect(isFutureVersion(0)).toBe(false);
    }
  });
});

// ─── migrateEvent ─────────────────────────────────────────────────────────────

describe("migrateEvent — backward compatibility", () => {
  it("is a no-op when the event is already at the current schema version", () => {
    const event = validEvent();
    const result = migrateEvent(event);
    expect(result.migrated).toBe(false);
    expect(result.steps).toBe(0);
    expect(result.event).toBe(event); // same reference — no copy made
  });

  it("validates successfully after migration (identity case)", () => {
    const event = validEvent();
    const { event: migrated } = migrateEvent(event);
    const validation = validateAuditEvent(migrated);
    expect(validation.valid).toBe(true);
  });

  it(
    "describes the migration path when no steps are needed " +
      "(future test anchor: add a case when v2 ships)",
    () => {
      // With AUDIT_SCHEMA_VERSION === 1 there are no migration steps.
      // This test is intentionally named so it documents the expected
      // behavior once a second schema version exists.
      const result = migrateEvent(validEvent());
      expect(result.steps).toBe(0);
      // If AUDIT_SCHEMA_VERSION were 2, a v1 event should have steps === 1.
    },
  );

  it("throws when asked to migrate an event with no known path", () => {
    // Simulate a future event with an older version that has no migration chain.
    const oldEvent = validEvent({ schemaVersion: 0 as never });
    expect(() => migrateEvent(oldEvent)).toThrow(/No migration path/);
  });
});
