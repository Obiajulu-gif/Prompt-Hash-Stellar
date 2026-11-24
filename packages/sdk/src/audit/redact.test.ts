/**
 * Redaction-rule tests — Issue #1094.
 *
 * Covers:
 *  - Every REDACTED_FIELDS key is replaced with REDACTION_SENTINEL in the
 *    payload, actor, and correlation envelopes.
 *  - Every HASHED_FIELDS key is replaced with a "sha256:<hex>" string.
 *  - Envelope identity fields (schemaVersion, name, occurredAt) are never
 *    redacted.
 *  - Nested objects are walked recursively.
 *  - Arrays are not recursed into (only their container key is checked).
 *  - Undefined / null HASHED_FIELDS values are preserved as-is.
 *  - `sha256Hex` is deterministic and produces a 64-char hex string.
 */
import { describe, expect, it } from "vitest";
import { redactEvent, redactObject, sha256Hex } from "./redact.js";
import {
  REDACTED_FIELDS,
  HASHED_FIELDS,
  REDACTION_SENTINEL,
  AUDIT_SCHEMA_VERSION,
  type AuditEvent,
} from "./types.js";

// ─── sha256Hex ────────────────────────────────────────────────────────────────

describe("sha256Hex", () => {
  it("produces a string prefixed with 'sha256:'", () => {
    expect(sha256Hex("hello")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic: same input → same output", () => {
    expect(sha256Hex("GBUYER123")).toBe(sha256Hex("GBUYER123"));
  });

  it("produces different output for different inputs", () => {
    expect(sha256Hex("GBUYER123")).not.toBe(sha256Hex("GCREATOR456"));
  });

  it("hex portion is exactly 64 characters (SHA-256 output)", () => {
    const hex = sha256Hex("any-input").replace("sha256:", "");
    expect(hex).toHaveLength(64);
  });
});

// ─── redactObject ─────────────────────────────────────────────────────────────

describe("redactObject — REDACTED_FIELDS", () => {
  it.each([...REDACTED_FIELDS])("replaces '%s' with the sentinel", (field) => {
    const result = redactObject({ [field]: "sensitive-value", safe: "keep-me" });
    expect(result[field]).toBe(REDACTION_SENTINEL);
    expect(result.safe).toBe("keep-me");
  });

  it("does not mutate the original object", () => {
    const original = { privateKey: "my-secret", safe: "value" };
    redactObject(original);
    expect(original.privateKey).toBe("my-secret");
  });
});

describe("redactObject — HASHED_FIELDS", () => {
  it.each([...HASHED_FIELDS])("hashes '%s' and prefixes with 'sha256:'", (field) => {
    const result = redactObject({ [field]: "GADDR000", safe: "untouched" });
    expect(String(result[field])).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.safe).toBe("untouched");
  });

  it("preserves null values in HASHED_FIELDS (optional fields)", () => {
    const result = redactObject({ referrer: null });
    expect(result.referrer).toBeNull();
  });

  it("preserves undefined values in HASHED_FIELDS (optional fields)", () => {
    const result = redactObject({ referrer: undefined });
    expect(result.referrer).toBeUndefined();
  });
});

describe("redactObject — recursion", () => {
  it("recurses into nested plain objects", () => {
    const nested = {
      outer: "safe",
      inner: { privateKey: "nested-secret", stellarAddress: "GNESTED" },
    };
    const result = redactObject(nested);
    expect((result.inner as Record<string, unknown>).privateKey).toBe(REDACTION_SENTINEL);
    expect((result.inner as Record<string, unknown>).stellarAddress).toMatch(/^sha256:/);
    expect(result.outer).toBe("safe");
  });

  it("does not recurse into arrays", () => {
    // Arrays are not walked — the array itself is returned as-is.
    const obj = { safe_array: ["GADDR", "GADDR2"] };
    const result = redactObject(obj);
    expect(result.safe_array).toEqual(["GADDR", "GADDR2"]);
  });

  it("does not recurse into Uint8Array (bytes32 fields)", () => {
    const bytes = new Uint8Array(32).fill(0xab);
    const obj = { wasm_hash: bytes };
    const result = redactObject(obj);
    expect(result.wasm_hash).toBe(bytes); // same reference
  });
});

// ─── redactEvent ─────────────────────────────────────────────────────────────

function makeEvent(payloadExtra: Record<string, unknown> = {}): AuditEvent {
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    name: "Prompt.Purchased",
    occurredAt: "2025-01-15T12:00:00.000Z",
    actor: {
      stellarAddress: "GBUYER000000000000000000000000000000000000000000000000000",
    },
    resource: { type: "prompt", id: "42" },
    correlation: { txHash: "deadbeef" },
    payload: {
      prompt_id: 42n,
      price_stroops: 5_000_0000000n,
      ...payloadExtra,
    },
  };
}

describe("redactEvent — envelope identity fields", () => {
  it("preserves schemaVersion, name, and occurredAt", () => {
    const event = makeEvent();
    const redacted = redactEvent(event);
    expect(redacted.schemaVersion).toBe(event.schemaVersion);
    expect(redacted.name).toBe(event.name);
    expect(redacted.occurredAt).toBe(event.occurredAt);
  });

  it("preserves resource (no sensitive fields)", () => {
    const event = makeEvent();
    const redacted = redactEvent(event);
    expect(redacted.resource).toEqual(event.resource);
  });
});

describe("redactEvent — actor", () => {
  it("hashes stellarAddress in actor", () => {
    const event = makeEvent();
    const redacted = redactEvent(event);
    expect(String(redacted.actor.stellarAddress)).toMatch(/^sha256:/);
  });

  it("preserves serviceId (not in HASHED_FIELDS)", () => {
    const event = makeEvent();
    event.actor = { serviceId: "indexer" };
    const redacted = redactEvent(event);
    expect(redacted.actor.serviceId).toBe("indexer");
  });
});

describe("redactEvent — payload", () => {
  it("replaces REDACTED_FIELDS in payload with the sentinel", () => {
    const event = makeEvent({ privateKey: "super-secret" });
    const redacted = redactEvent(event);
    expect(redacted.payload.privateKey).toBe(REDACTION_SENTINEL);
  });

  it("hashes HASHED_FIELDS in payload", () => {
    const event = makeEvent({ buyer: "GBUYER999", creator: "GCREATOR888" });
    const redacted = redactEvent(event);
    expect(String(redacted.payload.buyer)).toMatch(/^sha256:/);
    expect(String(redacted.payload.creator)).toMatch(/^sha256:/);
  });

  it("preserves non-sensitive payload fields", () => {
    const event = makeEvent();
    const redacted = redactEvent(event);
    expect(redacted.payload.prompt_id).toBe(42n);
    expect(redacted.payload.price_stroops).toBe(5_000_0000000n);
  });

  it("does not mutate the original event", () => {
    const event = makeEvent({ privateKey: "secret", buyer: "GBUYER" });
    redactEvent(event);
    expect(event.payload.privateKey).toBe("secret");
    expect(event.payload.buyer).toBe("GBUYER");
  });
});

describe("redactEvent — REDACTED_FIELDS completeness", () => {
  it("every REDACTED_FIELDS key is replaced when present in the payload", () => {
    const payload: Record<string, unknown> = {};
    for (const field of REDACTED_FIELDS) {
      payload[field] = `value-of-${field}`;
    }
    const event = makeEvent(payload);
    const redacted = redactEvent(event);
    for (const field of REDACTED_FIELDS) {
      expect(redacted.payload[field]).toBe(REDACTION_SENTINEL);
    }
  });

  it("every HASHED_FIELDS key is hashed when present in the payload", () => {
    const payload: Record<string, unknown> = {};
    for (const field of HASHED_FIELDS) {
      payload[field] = `address-${field}`;
    }
    const event = makeEvent(payload);
    const redacted = redactEvent(event);
    for (const field of HASHED_FIELDS) {
      expect(String(redacted.payload[field])).toMatch(/^sha256:/);
    }
  });
});
