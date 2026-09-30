import { describe, expect, it } from "vitest";
import { createPromptSchema } from "./listing";

const validListing = {
  imageUrl: "https://example.com/cover.png",
  title: "Useful prompt",
  category: "Writing",
  previewText: "A sufficiently detailed preview.",
  description: "A sufficiently detailed description.",
  fullPrompt: "Write something useful.",
  priceXlm: "2",
};

describe("source prompt validation", () => {
  it("allows an omitted source prompt ID", () => {
    expect(createPromptSchema.safeParse(validListing).success).toBe(true);
  });

  it("accepts a positive numeric source prompt ID", () => {
    expect(
      createPromptSchema.safeParse({ ...validListing, sourcePromptId: "42" })
        .success,
    ).toBe(true);
  });

  it.each(["abc", "-1", "0", "1.5"])("rejects invalid source ID %s", (id) => {
    expect(
      createPromptSchema.safeParse({ ...validListing, sourcePromptId: id })
        .success,
    ).toBe(false);
  });
});
