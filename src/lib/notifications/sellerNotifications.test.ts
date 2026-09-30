import { describe, expect, it } from "vitest";
import {
  deriveNotifications,
  mergeNotifications,
  snapshotOf,
  summariseActivity,
  type SellerNotification,
} from "./sellerNotifications";
import type { PromptRecord } from "@/lib/stellar/promptHashClient";

function makePrompt(
  overrides: Partial<PromptRecord> & { id: bigint },
): PromptRecord {
  return {
    creator: "GSELLER",
    priceStroops: 1000n,
    title: `Prompt ${overrides.id.toString()}`,
    category: "Development",
    previewText: "preview",
    imageUrl: "",
    salesCount: 0,
    active: true,
    contentHash: "hash",
    ...overrides,
  };
}

const NOW = 1_700_000_000_000;

describe("summariseActivity", () => {
  it("totals listings, active listings and sales", () => {
    const prompts = [
      makePrompt({ id: 1n, salesCount: 3, active: true }),
      makePrompt({ id: 2n, salesCount: 1, active: false }),
    ];
    expect(summariseActivity(prompts)).toEqual({
      totalListings: 2,
      activeListings: 1,
      totalSales: 4,
    });
  });
});

describe("deriveNotifications", () => {
  it("emits nothing on the first load (no previous snapshot)", () => {
    const prompts = [makePrompt({ id: 1n, salesCount: 5 })];
    expect(deriveNotifications(null, prompts, NOW)).toEqual([]);
  });

  it("detects new sales", () => {
    const previous = snapshotOf([makePrompt({ id: 1n, salesCount: 2 })]);
    const current = [makePrompt({ id: 1n, salesCount: 5 })];
    const result = deriveNotifications(previous, current, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("sale");
    expect(result[0].id).toBe("sale:1:5");
    expect(result[0].message).toContain("3 new sales");
  });

  it("detects delisting and price changes", () => {
    const previous = snapshotOf([
      makePrompt({ id: 1n, active: true, priceStroops: 1000n }),
    ]);
    const current = [makePrompt({ id: 1n, active: false, priceStroops: 2000n })];
    const result = deriveNotifications(previous, current, NOW);
    const ids = result.map((n) => n.id);
    expect(ids).toContain("listing-active:1:false");
    expect(ids).toContain("listing-price:1:2000");
  });

  it("ignores brand-new listings not present in the previous snapshot", () => {
    const previous = snapshotOf([makePrompt({ id: 1n, salesCount: 0 })]);
    const current = [
      makePrompt({ id: 1n, salesCount: 0 }),
      makePrompt({ id: 2n, salesCount: 9 }),
    ];
    expect(deriveNotifications(previous, current, NOW)).toEqual([]);
  });
});

describe("mergeNotifications", () => {
  const base: SellerNotification = {
    id: "sale:1:1",
    type: "sale",
    promptId: "1",
    title: "Prompt 1",
    message: "New sale",
    createdAt: NOW,
    read: false,
  };

  it("prepends fresh notifications and drops duplicates by id", () => {
    const existing = [base];
    const incoming = [
      base, // duplicate id — ignored
      { ...base, id: "sale:1:2", message: "Another sale" },
    ];
    const merged = mergeNotifications(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe("sale:1:2");
    expect(merged[1].id).toBe("sale:1:1");
  });
});
