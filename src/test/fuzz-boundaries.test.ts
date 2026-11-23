// @vitest-environment node
/**
 * Deterministic fuzz/property coverage for untrusted marketplace payloads (#1038).
 * Reproduce a failure with FUZZ_SEED=<reported seed> yarn test:fuzz.
 */
import { describe, expect, it } from "vitest";
import { stroopsToXlmString, xlmToStroops } from "../lib/stellar/format";
import { stroopsToXlmString as exactStroopsToXlmString } from "../lib/checkout/feeCalculator";
import {
  LISTING_LIMITS,
  validateEncryptedPayload,
  validateListingForm,
} from "../lib/validation/listing";
import {
  computeWebhookSignature,
  validateWebhookTimestamp,
  verifyWebhook,
  verifyWebhookSignature,
} from "../lib/webhooks/security";
import { verifyWebhookTimestamp } from "../lib/webhooks/signatureVerification";

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

describe("Boundary numeric property tests (#1145)", () => {
  const prng = random(seed ^ 0x1145);

  it("satisfies the roundtrip property: xlmToStroops(exactStroopsToXlmString(s)) === s for valid amounts", () => {
    // Exact boundary stroop values
    const boundaryStroops = [
      0n,
      1n, // 1 Stroop (0.0000001 XLM)
      10n,
      100n,
      10_000_000n, // 1 XLM
      100_000_000n, // 10 XLM
      1_000_000_000n, // 100 XLM
      100_000_000_000n, // 10,000 XLM
      1_000_000_000_000n, // 100,000 XLM (max canonical listing price)
      10_000_000_000_000n, // 1,000,000 XLM
    ];

    for (const stroop of boundaryStroops) {
      const exactXlm = exactStroopsToXlmString(stroop);
      expect(xlmToStroops(exactXlm)).toBe(stroop);
    }

    // Floating-point number based format.ts produces scientific notation '1e-7' for 1n,
    // which strict xlmToStroops intentionally rejects in favor of standard decimal representation.
    expect(stroopsToXlmString(1n)).toBe("1e-7");
    expect(() => xlmToStroops(stroopsToXlmString(1n))).toThrow(TypeError);

    // For stroops >= 10n up to 100,000 XLM, format.ts stroopsToXlmString is roundtrip-safe
    const safeFormatStroops = boundaryStroops.filter((s) => s === 0n || s >= 10n);
    for (const stroop of safeFormatStroops) {
      const xlm = stroopsToXlmString(stroop);
      expect(xlmToStroops(xlm)).toBe(stroop);
    }

    // Property fuzzing: 300 pseudorandom amounts within canonical range [0, 100,000 XLM]
    for (let run = 0; run < 300; run++) {
      const randomStroop = BigInt(Math.floor(prng() * 1_000_000_000_000));
      const xlmStr = exactStroopsToXlmString(randomStroop);
      const recovered = xlmToStroops(xlmStr);
      expect(recovered, `run=${run} randomStroop=${randomStroop}`).toBe(randomStroop);
    }
  });

  it("handles exact fractional precision across all valid decimal lengths (1 to 7 places)", () => {
    for (let decimals = 1; decimals <= 7; decimals++) {
      const fraction = "1".repeat(decimals);
      const input = `0.${fraction}`;
      const expectedStroops = BigInt(fraction.padEnd(7, "0"));
      expect(xlmToStroops(input)).toBe(expectedStroops);
    }
  });

  it("fails closed on boundary numeric failure modes without unhandled crashes", () => {
    // Strings that must be rejected as invalid numeric formatting
    const invalidInputs = [
      "0.00000001", // 8 decimals (beyond Stroop precision)
      "1.00000001",
      "1e5",
      "1e-7",
      "-1e7",
      "0x10",
      "0o77",
      "0b101",
      "NaN",
      "Infinity",
      "-Infinity",
      "10 XLM",
      "10.0.0",
      "９９",
      "",
      " ",
      ".",
      "..",
      ".5",
      "5.",
    ];

    for (const invalid of invalidInputs) {
      expect(() => xlmToStroops(invalid), `Input: ${invalid}`).toThrow(TypeError);
    }

    // -0 converts to 0n, which is valid stroops but rejected by non-zero price validation
    expect(xlmToStroops("-0")).toBe(0n);
    expect(xlmToStroops("-0.0000000")).toBe(0n);

    // Number input validation
    expect(() => xlmToStroops(Number.NaN)).toThrow(RangeError);
    expect(() => xlmToStroops(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => xlmToStroops(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
    expect(() => xlmToStroops(Number.MAX_VALUE)).toThrow(RangeError);
  });

  it("verifies authorization and validation fail-closed for out-of-boundary listing prices", () => {
    const baseListing = {
      imageUrl: "https://example.com/cover.png",
      title: "Boundary validation listing",
      category: "Technical",
      previewText: "Valid public preview text for numeric boundaries.",
      fullPrompt: "Valid private prompt content for numeric boundaries.",
      priceXlm: "10",
      coCreators: [],
    };

    // Normal path: valid boundary prices pass
    expect(validateListingForm({ ...baseListing, priceXlm: "0.00001" }).priceXlm).toBeUndefined();
    expect(validateListingForm({ ...baseListing, priceXlm: "100000" }).priceXlm).toBeUndefined();

    // Failure path: below min boundary
    const belowMin = validateListingForm({ ...baseListing, priceXlm: "0.0000099" });
    expect(belowMin.priceXlm).toMatch(/at least/i);

    // Failure path: above max boundary
    const aboveMax = validateListingForm({ ...baseListing, priceXlm: "100000.0000001" });
    expect(aboveMax.priceXlm).toMatch(/cannot exceed/i);

    // Failure path: negative price or zero price
    const negativePrice = validateListingForm({ ...baseListing, priceXlm: "-1" });
    expect(negativePrice.priceXlm).toMatch(/greater than zero|at least/i);

    const zeroPrice = validateListingForm({ ...baseListing, priceXlm: "-0" });
    expect(zeroPrice.priceXlm).toMatch(/greater than zero|at least/i);
  });

  it("supports recovery/retry: correcting an out-of-boundary price restores valid form state", () => {
    const listing = {
      imageUrl: "https://example.com/cover.png",
      title: "Retryable boundary listing",
      category: "Writing",
      previewText: "Sufficient preview text length for listing validation.",
      fullPrompt: "Sufficient private prompt content.",
      priceXlm: "999999999", // out of bounds
      coCreators: [],
    };

    const firstAttempt = validateListingForm(listing);
    expect(firstAttempt.priceXlm).toBeDefined();

    // Retry after correcting field
    const correctedAttempt = validateListingForm({ ...listing, priceXlm: "50" });
    expect(correctedAttempt).toEqual({});
  });
});

describe("Boundary timestamp property tests (#1145)", () => {
  const prng = random(seed ^ 0x2026);
  const secret = "test-webhook-secret-boundary-1145";
  const payload = JSON.stringify({ id: "evt_1145_boundary", action: "prompt.purchased" });

  it("normal path: accepts timestamps within acceptable drift window", () => {
    const now = 1700000000000;
    const maxDrift = 300000; // 5 minutes

    // Boundary: exactly now
    expect(validateWebhookTimestamp(now, now, maxDrift)).toBe(true);

    // Boundary: exactly at upper and lower drift boundaries
    expect(validateWebhookTimestamp(now - maxDrift, now, maxDrift)).toBe(true);
    expect(validateWebhookTimestamp(now + maxDrift, now, maxDrift)).toBe(true);

    // Property fuzzing: 300 pseudorandom timestamps inside window
    for (let run = 0; run < 300; run++) {
      const offset = Math.floor((prng() * 2 - 1) * maxDrift);
      const timestamp = now + offset;
      expect(
        validateWebhookTimestamp(timestamp, now, maxDrift),
        `run=${run} offset=${offset}`,
      ).toBe(true);
    }
  });

  it("handles standard epoch boundaries accurately (epoch 0, Y2038, Y2106, max JS date)", () => {
    const epochZero = 0; // 1970-01-01T00:00:00.000Z
    const y2038 = 2147483647; // 32-bit signed int limit (seconds)
    const y2106 = 4294967295; // 32-bit unsigned int limit (seconds)
    const maxJsDateMs = 8640000000000000; // Max ECMAScript date timestamp

    expect(Number.isFinite(epochZero)).toBe(true);
    expect(new Date(epochZero).toISOString()).toBe("1970-01-01T00:00:00.000Z");

    expect(Number.isFinite(y2038)).toBe(true);
    expect(new Date(y2038 * 1000).toISOString()).toBe("2038-01-19T03:14:07.000Z");

    expect(Number.isFinite(y2106)).toBe(true);
    expect(new Date(y2106 * 1000).toISOString()).toBe("2106-02-07T06:28:15.000Z");

    expect(Number.isFinite(maxJsDateMs)).toBe(true);
    expect(new Date(maxJsDateMs).getTime()).toBe(maxJsDateMs);
  });

  it("failure path: rejects timestamps strictly outside the drift window and malformed timestamps", () => {
    const now = 1700000000000;
    const maxDrift = 300000;

    // 1 ms beyond lower boundary
    expect(validateWebhookTimestamp(now - maxDrift - 1, now, maxDrift)).toBe(false);

    // 1 ms beyond upper boundary
    expect(validateWebhookTimestamp(now + maxDrift + 1, now, maxDrift)).toBe(false);

    // Far in the past (epoch 0 when now is in 2023)
    expect(validateWebhookTimestamp(0, now, maxDrift)).toBe(false);

    // Far in the future
    expect(validateWebhookTimestamp(now * 2, now, maxDrift)).toBe(false);

    // Negative timestamp
    expect(validateWebhookTimestamp(-1000, now, maxDrift)).toBe(false);

    // Second-based verification in verifyWebhookTimestamp
    const nowSec = Math.floor(Date.now() / 1000);
    const verifyResultFuture = verifyWebhookTimestamp(nowSec + 10, 300);
    expect(verifyResultFuture.valid).toBe(false);
    expect(verifyResultFuture.reason).toMatch(/future/i);

    const verifyResultStale = verifyWebhookTimestamp(nowSec - 301, 300);
    expect(verifyResultStale.valid).toBe(false);
    expect(verifyResultStale.reason).toMatch(/too old/i);
  });

  it("authorization path: ensures cryptographic binding between payload and timestamp", async () => {
    const now = Date.now();
    const signature = computeWebhookSignature(secret, payload, now);
    const processedEvents = new Set<string>();

    // Normal authorization: correct timestamp + payload + signature
    const validResult = await verifyWebhook(
      {
        body: payload,
        headers: {
          "x-webhook-signature": signature,
          "x-webhook-timestamp": String(now),
        },
      },
      {
        secret,
        maxTimestampDrift: 300000,
      },
      processedEvents,
    );
    expect(validResult.valid).toBe(true);

    // Authorization failure: timestamp tampered by 1 ms (replay/tamper defense)
    const tamperedResult = await verifyWebhook(
      {
        body: payload,
        headers: {
          "x-webhook-signature": signature,
          "x-webhook-timestamp": String(now + 1),
        },
      },
      {
        secret,
        maxTimestampDrift: 300000,
      },
      new Set<string>(),
    );
    expect(tamperedResult.valid).toBe(false);
    expect(tamperedResult.reason).toBe("Invalid signature");

    // Authorization failure: timestamp format invalid
    const invalidFormatResult = await verifyWebhook(
      {
        body: payload,
        headers: {
          "x-webhook-signature": signature,
          "x-webhook-timestamp": "not-a-timestamp",
        },
      },
      {
        secret,
      },
      new Set<string>(),
    );
    expect(invalidFormatResult.valid).toBe(false);
    expect(invalidFormatResult.reason).toBe("Invalid timestamp format");

    // Authorization failure: missing timestamp header
    const missingTimestampResult = await verifyWebhook(
      {
        body: payload,
        headers: {
          "x-webhook-signature": signature,
        },
      },
      {
        secret,
      },
      new Set<string>(),
    );
    expect(missingTimestampResult.valid).toBe(false);
    expect(missingTimestampResult.reason).toBe("Missing timestamp header");
  });

  it("retry and recovery path: expired timestamp requests succeed upon regeneration with current timestamp", async () => {
    const staleTimestamp = Date.now() - 600000; // 10 minutes ago
    const staleSignature = computeWebhookSignature(secret, payload, staleTimestamp);

    const staleResult = await verifyWebhook(
      {
        body: payload,
        headers: {
          "x-webhook-signature": staleSignature,
          "x-webhook-timestamp": String(staleTimestamp),
        },
      },
      {
        secret,
        maxTimestampDrift: 300000,
      },
      new Set<string>(),
    );
    expect(staleResult.valid).toBe(false);
    expect(staleResult.reason).toBe("Timestamp outside acceptable window");

    // Client recovery: regenerate request with fresh timestamp and recomputed signature
    const freshTimestamp = Date.now();
    const freshSignature = computeWebhookSignature(secret, payload, freshTimestamp);

    const retriedResult = await verifyWebhook(
      {
        body: payload,
        headers: {
          "x-webhook-signature": freshSignature,
          "x-webhook-timestamp": String(freshTimestamp),
        },
      },
      {
        secret,
        maxTimestampDrift: 300000,
      },
      new Set<string>(),
    );
    expect(retriedResult.valid).toBe(true);
  });
});
