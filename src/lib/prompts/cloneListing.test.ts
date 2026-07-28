import { describe, it, expect, beforeEach } from "vitest";
import {
  buildCloneDraftFormData,
  canCloneListing,
  hasExistingDraft,
  seedCloneDraft,
} from "./cloneListing";
import { getDraftStorageKey } from "@/hooks/useDraftAutoSave";
import type { PromptRecord } from "@/lib/stellar/promptHashClient";

const OWNER = "GABC1234567890OWNERADDRESS0000000000000000000";
const OTHER = "GXYZ9999990000OTHERADDRESS00000000000000000";

function makePrompt(overrides: Partial<PromptRecord> = {}): PromptRecord {
  return {
    id: 42n,
    creator: OWNER,
    priceStroops: 25_000_000n,
    title: "Launch plan",
    category: "Marketing",
    previewText: "A great preview",
    description: "Full description",
    tags: ["launch", "b2b"],
    imageUrl: "https://example.com/cover.png",
    salesCount: 7,
    active: true,
    contentHash: "abc123",
    encryptedPrompt: "secret-ciphertext",
    encryptionIv: "iv-value",
    wrappedKey: "wrapped-key-value",
    ...overrides,
  };
}

describe("buildCloneDraftFormData", () => {
  it("copies public metadata, category, tags, and price", () => {
    const draft = buildCloneDraftFormData(makePrompt());

    expect(draft).toMatchObject({
      imageUrl: "https://example.com/cover.png",
      title: "Launch plan (copy)",
      category: "Marketing",
      previewText: "A great preview",
      description: "Full description",
      tags: ["launch", "b2b"],
      priceXlm: "2.5",
      licence: "standard",
    });
  });

  it("never copies the encrypted payload, listing id, sales count, or content hash", () => {
    const draft = buildCloneDraftFormData(makePrompt());

    expect(draft).not.toHaveProperty("encryptedPrompt");
    expect(draft).not.toHaveProperty("wrappedKey");
    expect(draft).not.toHaveProperty("encryptionIv");
    expect(draft).not.toHaveProperty("id");
    expect(draft).not.toHaveProperty("onChainId");
    expect(draft).not.toHaveProperty("salesCount");
    expect(draft).not.toHaveProperty("contentHash");
    expect(draft).not.toHaveProperty("fullPrompt");
  });
});

describe("canCloneListing", () => {
  it("allows the prompt's own creator", () => {
    expect(canCloneListing(makePrompt({ creator: OWNER }), OWNER)).toBe(true);
  });

  it("is case-insensitive on the wallet address", () => {
    expect(canCloneListing(makePrompt({ creator: OWNER }), OWNER.toLowerCase())).toBe(true);
  });

  it("denies a wallet that does not own the listing", () => {
    expect(canCloneListing(makePrompt({ creator: OWNER }), OTHER)).toBe(false);
  });

  it("denies when no wallet is connected", () => {
    expect(canCloneListing(makePrompt({ creator: OWNER }), undefined)).toBe(false);
  });
});

describe("seedCloneDraft / hasExistingDraft", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("writes the clone into the same draft slot useDraftAutoSave reads", () => {
    seedCloneDraft(makePrompt(), OWNER);

    const raw = window.localStorage.getItem(getDraftStorageKey(OWNER));
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw as string);
    expect(parsed.formData.title).toBe("Launch plan (copy)");
    expect(typeof parsed.savedAt).toBe("string");
  });

  it("reports whether a draft already exists for the wallet", () => {
    expect(hasExistingDraft(OWNER)).toBe(false);
    seedCloneDraft(makePrompt(), OWNER);
    expect(hasExistingDraft(OWNER)).toBe(true);
  });
});
