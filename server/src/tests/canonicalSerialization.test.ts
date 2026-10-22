import { describe, it, expect } from "vitest";
import {
  canonicalize,
  canonicalHash,
  verifyCanonicalHash,
  normalizeInput,
  isCanonicallyEquivalent,
  type CanonicalOptions,
} from "../services/canonicalSerialization";

describe("canonicalize - ordering (Issue #873)", () => {
  it("sorts object keys alphabetically by default", () => {
    const a = canonicalize({ b: 1, a: 2, c: 3 });
    const b = canonicalize({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it("preserves insertion order when sortKeys is disabled", () => {
    const a = canonicalize({ b: 1, a: 2 }, { sortKeys: false });
    const b = canonicalize({ a: 2, b: 1 }, { sortKeys: false });
    expect(a).not.toBe(b);
  });

  it("handles nested objects with sorted keys at every level", () => {
    const a = canonicalize({ z: { y: 1, x: 2 }, a: { c: 3, b: 4 } });
    const b = canonicalize({ a: { b: 4, c: 3 }, z: { x: 2, y: 1 } });
    expect(a).toBe(b);
  });
});

describe("canonicalize - whitespace (Issue #873)", () => {
  it("trims leading and trailing whitespace", () => {
    const a = canonicalize("  hello world  ");
    const b = canonicalize("hello world");
    expect(a).toBe(b);
  });

  it("collapses internal multiple spaces to one", () => {
    const a = canonicalize("hello   world    test");
    const b = canonicalize("hello world test");
    expect(a).toBe(b);
  });

  it("normalizes newlines and tabs to spaces", () => {
    const a = canonicalize("hello\nworld\ttest");
    const b = canonicalize("hello world test");
    expect(a).toBe(b);
  });

  it("does not normalize whitespace when disabled", () => {
    const a = canonicalize("hello  world", { normalizeWhitespace: false });
    const b = canonicalize("hello world", { normalizeWhitespace: false });
    expect(a).not.toBe(b);
  });
});

describe("canonicalize - casing (Issue #873)", () => {
  it("lowercases strings when lowerCase option is enabled", () => {
    const a = canonicalize("Hello World", { lowerCase: true });
    const b = canonicalize("hello world", { lowerCase: true });
    expect(a).toBe(b);
  });

  it("preserves case by default", () => {
    const a = canonicalize("Hello World");
    const b = canonicalize("hello world");
    expect(a).not.toBe(b);
  });
});

describe("canonicalize - numeric precision (Issue #873)", () => {
  it("normalizes numeric precision to prevent floating-point drift", () => {
    const a = canonicalize(0.1 + 0.2);
    const b = canonicalize(0.30000000000000004);
    expect(a).toBe(b);
  });

  it("keeps representable values within the default 18-decimal precision", () => {
    expect(canonicalize(1.23456789012345)).toBe("1.23456789012345");
  });

  it("allows custom numeric precision", () => {
    const a = canonicalize(1.2345, { numericPrecision: 2 });
    const b = canonicalize(1.2399, { numericPrecision: 2 });
    expect(a).toBe(b);
  });
});

describe("canonicalize - dates and primitives (Issue #873)", () => {
  it("serializes dates to ISO strings", () => {
    const d = new Date("2026-01-15T10:30:00.000Z");
    const result = canonicalize(d);
    expect(result).toBe(JSON.stringify("2026-01-15T10:30:00.000Z"));
  });

  it("handles null and undefined", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(undefined)).toBe("null");
  });

  it("handles booleans and numbers", () => {
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(42)).toBe("42");
  });

  it("handles arrays with canonicalized elements", () => {
    const a = canonicalize([{ b: 1, a: 2 }, { d: 3, c: 4 }]);
    const b = canonicalize([{ c: 4, d: 3 }, { a: 2, b: 1 }]);
    expect(a).toBe(b);
  });
});

describe("canonicalHash (Issue #873)", () => {
  it("produces identical hashes for canonically equivalent inputs", async () => {
    const hashA = await canonicalHash({ b: 1, a: 2 });
    const hashB = await canonicalHash({ a: 2, b: 1 });
    expect(hashA).toBe(hashB);
  });

  it("produces different hashes for different inputs", async () => {
    const hashA = await canonicalHash({ a: 1 });
    const hashB = await canonicalHash({ a: 2 });
    expect(hashA).not.toBe(hashB);
  });

  it("returns hex-encoded SHA-256", async () => {
    const hash = await canonicalHash("test");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyCanonicalHash (Issue #873)", () => {
  it("returns true for matching hash", async () => {
    const value = { a: 1, b: 2 };
    const hash = await canonicalHash(value);
    const valid = await verifyCanonicalHash({ b: 2, a: 1 }, hash);
    expect(valid).toBe(true);
  });

  it("returns false for non-matching hash", async () => {
    const valid = await verifyCanonicalHash({ a: 1 }, "0000000000000000000000000000000000000000000000000000000000000000");
    expect(valid).toBe(false);
  });
});

describe("normalizeInput (Issue #873)", () => {
  it("returns normalized value without JSON serialization", () => {
    const result = normalizeInput({ b: 1, a: 2 });
    expect(result).toEqual({ a: 2, b: 1 });
  });
});

describe("isCanonicallyEquivalent - legacy compatibility (Issue #873)", () => {
  it("returns true for equivalent legacy and new payloads", () => {
    const legacy = { customer_name: "John Doe", amount: 100.00 };
    const neo = { amount: 100, customerName: "John Doe" };
    expect(isCanonicallyEquivalent(legacy, neo, { lowerCase: true })).toBe(true);
  });

  it("returns false for non-equivalent payloads", () => {
    const a = { amount: 100 };
    const b = { amount: 200 };
    expect(isCanonicallyEquivalent(a, b)).toBe(false);
  });
});