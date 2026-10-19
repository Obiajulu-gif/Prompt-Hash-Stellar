/**
 * Canonical serialization for signed and hashed payloads — Issue #979.
 *
 * Two guarantees are checked here:
 *   1. Equivalent payloads (same data, different key order or dropped
 *      `undefined` members) produce identical bytes, so their digests match.
 *   2. For JSON-compatible input, the shared serializer reproduces the bytes
 *      the previous per-module serializers produced, so digests already stored
 *      in the database still verify after this change.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { canonicalJson } from "../services/canonicalSerialization";
import * as auditTrail from "../services/auditTrail";
import { hashIdempotentRequest } from "../services/idempotencyService";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Verbatim copy of the webhook outbox serializer as it was before #979. */
function legacyWebhookCanonical(value: Record<string, unknown>): string {
  const sortDeep = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sortDeep);
    if (input && typeof input === "object") {
      return Object.keys(input as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = sortDeep((input as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return input;
  };
  return JSON.stringify(sortDeep(value));
}

/** Verbatim copy of the idempotency serializer as it was before #979. */
function legacyStableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(legacyStableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${legacyStableJson(object[key])}`)
    .join(",")}}`;
}

const FIXTURES: unknown[] = [
  { b: 1, a: 2, c: { z: [3, 1, 2], y: "text" } },
  { event: "prompt.purchased", data: { promptId: "42", price: 1.5, tags: ["a", "b"] } },
  [{ d: 1, c: null }, { f: true, e: false }],
  { unicode: "héllo ✓", escape: 'quote " and \\ slash', empty: {}, list: [] },
  { nullable: null, nested: { deep: { deeper: { deepest: 0 } } } },
];

describe("canonicalJson (#979)", () => {
  it("is independent of object key insertion order", () => {
    const a = canonicalJson({ b: 1, a: { y: 2, x: 1 } });
    const b = canonicalJson({ a: { x: 1, y: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"x":1,"y":2},"b":1}');
  });

  it("keeps array order, since arrays are ordered data", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });

  it("drops undefined members so they hash the same as an absent key", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("serializes Date values as their ISO string", () => {
    const at = new Date("2026-03-01T12:00:00.000Z");
    expect(canonicalJson({ at })).toBe(canonicalJson({ at: at.toISOString() }));
  });

  it("maps top-level undefined to null, matching JSON semantics", () => {
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson(null)).toBe("null");
  });

  it("matches the legacy webhook outbox serializer byte-for-byte", () => {
    for (const fixture of FIXTURES) {
      if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture)) continue;
      const record = fixture as Record<string, unknown>;
      expect(canonicalJson(record)).toBe(legacyWebhookCanonical(record));
    }
  });

  it("matches the legacy idempotency serializer byte-for-byte", () => {
    for (const fixture of FIXTURES) {
      expect(canonicalJson(fixture)).toBe(legacyStableJson(fixture));
    }
  });

  it("is the same implementation the audit trail re-exports", () => {
    expect(auditTrail.canonicalJson).toBe(canonicalJson);
  });
});

describe("request and payload digests (#979)", () => {
  it("hashIdempotentRequest ignores body key order", () => {
    const a = hashIdempotentRequest({
      method: "post",
      scope: "/prompts",
      body: { title: "t", price: 3, meta: { y: 1, x: 2 } },
    });
    const b = hashIdempotentRequest({
      method: "POST",
      scope: "/prompts",
      body: { meta: { x: 2, y: 1 }, price: 3, title: "t" },
    });
    expect(a).toBe(b);
  });

  it("hashIdempotentRequest reproduces the legacy digest for JSON bodies", () => {
    const body = { title: "t", tags: ["x"], nested: { b: 2, a: 1 } };
    const legacy = sha256(`POST\n/prompts\n${legacyStableJson(body)}`);
    expect(hashIdempotentRequest({ method: "post", scope: "/prompts", body })).toBe(legacy);
  });

  it("hashIdempotentRequest keeps the historical digest for an undefined body", () => {
    const legacy = sha256("GET\n/status\nundefined");
    expect(hashIdempotentRequest({ method: "get", scope: "/status", body: undefined })).toBe(
      legacy,
    );
  });

  it("hashIdempotentRequest still distinguishes different payloads", () => {
    const a = hashIdempotentRequest({ method: "POST", scope: "/x", body: { amount: 1 } });
    const b = hashIdempotentRequest({ method: "POST", scope: "/x", body: { amount: 2 } });
    expect(a).not.toBe(b);
  });
});
