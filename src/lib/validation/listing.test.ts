import { describe, expect, it } from "vitest";
import {
  buildListingChecklistItems,
  validateListingForm,
} from "./listing";

const validForm = {
  imageUrl: "https://example.com/cover.png",
  title: "Campaign launch pack",
  category: "Marketing",
  previewText: "Public preview text for buyers browsing the marketplace.",
  fullPrompt: "Private prompt body with enough content for validation.",
  priceXlm: "2.5",
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
      validateListingForm({ ...validForm, previewText: "short" }).previewText,
    ).toMatch(/at least 10 characters/i);
    expect(
      validateListingForm({ ...validForm, fullPrompt: "tiny" }).fullPrompt,
    ).toMatch(/at least 10 characters/i);
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
    });

    const failures = items.filter((item) => item.status === "fail");
    expect(failures.length).toBeGreaterThanOrEqual(6);
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
