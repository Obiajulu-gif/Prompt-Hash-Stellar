// @vitest-environment node
/**
 * Deterministic fuzz/property coverage for untrusted marketplace payloads (#1038).
 * Reproduce a failure with FUZZ_SEED=<reported seed> yarn test:fuzz.
 */
import { describe, expect, it } from "vitest";
import { xlmToStroops } from "../lib/stellar/format";
import {
  LISTING_LIMITS,
  validateEncryptedPayload,
  validateListingForm,
} from "../lib/validation/listing";

const seed = Number.parseInt(process.env.FUZZ_SEED ?? "1038", 10) >>> 0;

function random(seedValue: number): () => number {
  let state = seedValue || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const next = random(seed);
const atoms: unknown[] = [
  null,
  undefined,
  true,
  false,
  0,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  {},
  [],
  Symbol("fuzz"),
  "",
  "\0",
  "1e9",
  "1xyz",
  "0x10",
  "９９",
];

function fuzzValue(depth = 0): unknown {
  if (depth > 1 || next() < 0.65)
    return atoms[Math.floor(next() * atoms.length)];
  if (next() < 0.5)
    return Array.from({ length: Math.floor(next() * 5) }, () =>
      fuzzValue(depth + 1),
    );
  return { value: fuzzValue(depth + 1), nested: fuzzValue(depth + 1) };
}

describe(`deterministic malformed-payload fuzzing (seed=${seed})`, () => {
  it("rejects a malformed required field in an otherwise valid listing", () => {
    const valid = {
      imageUrl: "https://example.com/cover.png",
      title: "Marketplace fixture",
      category: "Writing",
      previewText: "A sufficiently long preview for this marketplace validation fixture.",
      fullPrompt: "Write a short story.",
      priceXlm: "1",
      coCreators: [],
    };
    expect(validateListingForm(valid)).toEqual({});
    const requiredFields = [
      "imageUrl", "title", "category", "previewText", "fullPrompt", "priceXlm",
    ] as const;
    const nextField = random(seed);
    for (let run = 0; run < 300; run++) {
      const field = requiredFields[Math.floor(nextField() * requiredFields.length)]!;
      const value = fuzzValue();
      if (typeof value === "string") continue;
      const errors = validateListingForm({ ...valid, [field]: value });
      expect(Object.keys(errors), `run=${run} seed=${seed} field=${field}`).toEqual([field]);
      expect(validateListingForm(valid)).toEqual({});
    }
  });

  it("fails closed without throwing for arbitrary listing field types", () => {
    for (let run = 0; run < 500; run++) {
      const payload = {
        imageUrl: fuzzValue(),
        title: fuzzValue(),
        category: fuzzValue(),
        previewText: fuzzValue(),
        fullPrompt: fuzzValue(),
        priceXlm: fuzzValue(),
        coCreators: fuzzValue(),
      };
      expect(
        () => validateListingForm(payload as never),
        `run=${run} seed=${seed}`,
      ).not.toThrow();
      expect(
        Object.keys(validateListingForm(payload as never)).length,
        `run=${run} seed=${seed}`,
      ).toBeGreaterThan(0);
    }
  });

  it("fails closed without throwing for arbitrary encrypted payload field types", () => {
    for (let run = 0; run < 300; run++) {
      const payload = {
        encryptedPrompt: fuzzValue(),
        wrappedKey: fuzzValue(),
        encryptionIv: fuzzValue(),
      };
      expect(
        () => validateEncryptedPayload(payload as never),
        `run=${run} seed=${seed}`,
      ).not.toThrow();
      const containsWrongType = Object.values(payload).some(
        (value) => typeof value !== "string" || value.length === 0,
      );
      if (containsWrongType) {
        expect(
          Object.keys(validateEncryptedPayload(payload as never)).length,
          `run=${run} seed=${seed}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("XLM and payload numeric boundaries", () => {
  it.each([
    ["0", 0n],
    ["0.0000001", 1n],
    ["1.0000000", 10_000_000n],
    ["100000", 1_000_000_000_000n],
    ["-0.0000001", -1n],
  ])("converts %s exactly", (input, expected) => {
    expect(xlmToStroops(input)).toBe(expected);
  });

  it.each([
    "",
    ".1",
    "1.",
    "1.00000001",
    "1e3",
    "1xyz",
    "Infinity",
    "NaN",
    "0x10",
  ])("rejects malformed numeric input %j", (input) =>
    expect(() => xlmToStroops(input)).toThrow(),
  );

  it("enforces the canonical listing price range at and around each boundary", () => {
    const form = {
      imageUrl: "https://example.com/cover.png",
      title: "Boundary test listing",
      category: "Marketing",
      previewText: "A valid public preview.",
      fullPrompt: "A valid private prompt.",
      priceXlm: "0.00001",
      coCreators: [],
    };
    expect(validateListingForm(form).priceXlm).toBeUndefined();
    expect(
      validateListingForm({ ...form, priceXlm: "0.0000001" }).priceXlm,
    ).toMatch(/at least/i);
    expect(
      validateListingForm({ ...form, priceXlm: "100000" }).priceXlm,
    ).toBeUndefined();
    expect(
      validateListingForm({ ...form, priceXlm: "100000.0000001" }).priceXlm,
    ).toMatch(/cannot exceed/i);
    expect(() => xlmToStroops(Number.MAX_VALUE)).toThrow(/range/i);
  });

  it("accepts exact payload limits and rejects one byte beyond them", () => {
    const atLimit = validateEncryptedPayload({
      encryptedPrompt: "p".repeat(LISTING_LIMITS.encryptedPayload),
      wrappedKey: "k".repeat(LISTING_LIMITS.wrappedKey),
      encryptionIv: "i".repeat(LISTING_LIMITS.encryptionIv),
    });
    expect(atLimit).toEqual({});
    expect(
      validateEncryptedPayload({
        encryptedPrompt: "p".repeat(LISTING_LIMITS.encryptedPayload + 1),
        wrappedKey: "k".repeat(LISTING_LIMITS.wrappedKey + 1),
        encryptionIv: "i".repeat(LISTING_LIMITS.encryptionIv + 1),
      }),
    ).toEqual(
      expect.objectContaining({
        encryptedPrompt: expect.any(String),
        wrappedKey: expect.any(String),
        encryptionIv: expect.any(String),
      }),
    );
  });
});
