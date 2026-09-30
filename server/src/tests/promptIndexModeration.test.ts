import { describe, expect, it } from "vitest";
import { buildMarketplaceQuery } from "../../../api/prompts/index";

describe("buildMarketplaceQuery — issue #717 moderation-aware filtering", () => {
  it("hides restricted and retired prompts from the public marketplace", () => {
    const query = buildMarketplaceQuery({});
    expect(query.listingStatus).toBe("published");
    expect(query.isActive).toBe(true);
    expect(query.moderationStatus).toEqual({ $in: [null, "none"] });
    expect(query.owner).toBeUndefined();
  });

  it("does not hide a creator's own moderated prompts in the dashboard view", () => {
    const query = buildMarketplaceQuery({ walletAddress: "GCREATOR" });
    expect(query.owner).toBe("GCREATOR");
    expect(query.moderationStatus).toBeUndefined();
    expect(query.listingStatus).toBeUndefined();
    expect(query.isActive).toBeUndefined();
  });

  it("supports a single-prompt lookup by onChainId", () => {
    const query = buildMarketplaceQuery({ onChainId: "12345" });
    expect(query.onChainId).toBe(12345);
    expect(query.listingStatus).toBeUndefined();
    expect(query.isActive).toBeUndefined();
    expect(query.moderationStatus).toBeUndefined();
  });

  it("passes through a category filter in the public view", () => {
    const query = buildMarketplaceQuery({ category: "Marketing" });
    expect(query.category).toBe("Marketing");
    expect(query.moderationStatus).toEqual({ $in: [null, "none"] });
  });
});
