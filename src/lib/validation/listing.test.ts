import { describe, expect, it } from "vitest";
import {
  buildListingChecklistItems,
  validateListingForm,
  validateEncryptedPayload,
  estimateEncryptedSize,
  wouldExceedPayloadLimit,
  LISTING_LIMITS,
} from "./listing";

const validForm = {
  imageUrl: "https://example.com/cover.png",
  title: "Campaign launch pack",
  category: "Marketing",
  previewText: "Public preview text for buyers browsing the marketplace.",
  fullPrompt: "Private prompt body with enough content for validation.",
  priceXlm: "2.5",
  coCreators: []
};

describe("validateListingForm", () => {
  it("accepts a complete valid listing", () => {
    expect(validateListingForm(validForm)).toEqual({});
  });

  it("blocks zero and invalid XLM prices", () => {
    expect(validateListingForm({ ...validForm, priceXlm: "0" }).priceXlm).toMatch(
      /greater than zero/i,
    );
    expect(validateListingForm({ ...validForm, priceXlm: "2e3" }).priceXlm).toMatch(
      /valid XLM amount/i,
    );
  });

  it("requires http(s) image URLs", () => {
    expect(
      validateListingForm({ ...validForm, imageUrl: "not-a-url" }).imageUrl,
    ).toMatch(/http/i);
  });

  it("enforces minimum title and content lengths", () => {
    expect(validateListingForm({ ...validForm, title: "AB" }).title).toMatch(
      /at least 3 characters/i,
    );
    expect(
      validateListingForm({ ...validForm, previewText: "short" }).previewText
    ).toMatch(/at least 10 characters/i);
    expect(validateListingForm({ ...validForm, fullPrompt: "" }).fullPrompt).toMatch(
      /add the full prompt content/i,
    );
  });
});

describe("buildListingChecklistItems", () => {
  it("marks required fields as fail with actionable hints", () => {
    const items = buildListingChecklistItems({
      imageUrl: "",
      title: "",
      category: "",
      previewText: "",
      fullPrompt: "",
      priceXlm: "",
      coCreators: []
    });

    const failures = items.filter((item) => item.status === "fail");
    expect(failures.length).toBeGreaterThanOrEqual(5);
    expect(failures.every((item) => Boolean(item.hint))).toBe(true);
  });

  it("adds non-blocking warnings for low-quality but valid listings", () => {
    const items = buildListingChecklistItems({
      ...validForm,
      title: "Short",
      previewText: "Still long enough for required validation here.",
      priceXlm: "0.25",
    });

    expect(items.some((item) => item.status === "warn")).toBe(true);
  });
});

describe("validateEncryptedPayload", () => {
  it("accepts a valid payload within limits", () => {
    expect(
      validateEncryptedPayload({
        encryptedPrompt: "a".repeat(1000),
        wrappedKey: "b".repeat(100),
        encryptionIv: "c".repeat(24),
      }),
    ).toEqual({});
  });

  it("rejects an oversized encrypted prompt", () => {
    const errors = validateEncryptedPayload({
      encryptedPrompt: "a".repeat(LISTING_LIMITS.encryptedPayload + 1),
      wrappedKey: "b".repeat(100),
      encryptionIv: "c".repeat(24),
    });
    expect(errors.encryptedPrompt).toMatch(/exceeding the on-chain limit/i);
  });

  it("rejects an oversized wrapped key", () => {
    const errors = validateEncryptedPayload({
      encryptedPrompt: "a".repeat(1000),
      wrappedKey: "b".repeat(LISTING_LIMITS.wrappedKey + 1),
      encryptionIv: "c".repeat(24),
    });
    expect(errors.wrappedKey).toMatch(/exceeding the limit/i);
  });

  it("rejects an oversized encryption IV", () => {
    const errors = validateEncryptedPayload({
      encryptedPrompt: "a".repeat(1000),
      wrappedKey: "b".repeat(100),
      encryptionIv: "c".repeat(LISTING_LIMITS.encryptionIv + 1),
    });
    expect(errors.encryptionIv).toMatch(/exceeding the limit/i);
  });

  it("rejects empty fields", () => {
    const errors = validateEncryptedPayload({
      encryptedPrompt: "",
      wrappedKey: "",
      encryptionIv: "",
    });
    expect(errors.encryptedPrompt).toMatch(/missing/i);
    expect(errors.wrappedKey).toMatch(/missing/i);
    expect(errors.encryptionIv).toMatch(/missing/i);
  });

  it("accepts payloads at exactly the limit", () => {
    expect(
      validateEncryptedPayload({
        encryptedPrompt: "a".repeat(LISTING_LIMITS.encryptedPayload),
        wrappedKey: "b".repeat(LISTING_LIMITS.wrappedKey),
        encryptionIv: "c".repeat(LISTING_LIMITS.encryptionIv),
      }),
    ).toEqual({});
  });
});

describe("estimateEncryptedSize", () => {
  it("estimates encryption overhead", () => {
    const estimate = estimateEncryptedSize(1000);
    expect(estimate).toBeGreaterThan(1000);
  });
});

describe("wouldExceedPayloadLimit", () => {
  it("returns false for small prompts", () => {
    expect(wouldExceedPayloadLimit(100)).toBe(false);
  });

  it("returns true for prompts that would exceed the encrypted limit", () => {
    expect(wouldExceedPayloadLimit(5000)).toBe(true);
  });
});

describe("validateListingForm encrypted payload warning", () => {
  it("warns when prompt would exceed encrypted payload limit", () => {
    const errors = validateListingForm({ 
      ...validForm,
      fullPrompt: "a".repeat(4000),
    });
    expect(errors.fullPrompt).toMatch(/on-chain encrypted payload limit/i);
  });

  it("accepts prompts that fit within the encrypted limit", () => {
    const errors = validateListingForm({
      ...validForm,
      fullPrompt: "a".repeat(100),
    });
    expect(errors.fullPrompt).toBeUndefined();
  });
});
