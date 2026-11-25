import { describe, expect, it } from "vitest";
import {
  evaluateVisibility,
  buildPublicVisibilityFilter,
  isPubliclyVisible,
} from "../../../packages/schema/src/visibility";

const OWNER = "GOWNER";
const STRANGER = "GSTRANGER";
const MODERATOR = "GMODERATOR";

const hidden = {
  _id: "hidden-1",
  title: "Hidden prompt",
  owner: { walletAddress: OWNER },
  lifecycleState: "hidden",
  moderationStatus: "hidden",
  isActive: false,
  listingStatus: "published",
  content: "hidden-secret",
  encryptedPrompt: "hidden-cipher",
};

const archived = {
  _id: "archived-1",
  title: "Archived prompt",
  owner: { walletAddress: OWNER },
  lifecycleState: "archived",
  listingStatus: "archived",
  isActive: false,
  archivedAt: new Date("2026-11-20T00:00:00Z"),
  content: "archived-secret",
  encryptedPrompt: "archived-cipher",
};

describe("hidden and archived record authorization", () => {
  it("denies anonymous and stranger access to hidden records", () => {
    expect(evaluateVisibility(hidden).httpStatus).toBe(403);
    expect(evaluateVisibility(hidden, { viewerWallet: STRANGER }).canAccess).toBe(false);
    expect(evaluateVisibility(hidden, { viewerWallet: STRANGER }).httpStatus).toBe(403);
  });

  it("allows only owner, moderator, or admin for hidden direct lookup", () => {
    expect(evaluateVisibility(hidden, { viewerWallet: OWNER }).canAccess).toBe(true);
    expect(evaluateVisibility(hidden, { viewerWallet: MODERATOR, role: "moderator" }).canAccess).toBe(true);
    expect(evaluateVisibility(hidden, { viewerWallet: MODERATOR, role: "admin" }).canAccess).toBe(true);
  });

  it("returns a safe tombstone for archived direct lookup to every caller", () => {
    for (const viewer of [
      undefined,
      { viewerWallet: STRANGER },
      { viewerWallet: OWNER },
      { viewerWallet: MODERATOR, role: "moderator" },
      { viewerWallet: MODERATOR, role: "admin" },
    ]) {
      const evaluation = evaluateVisibility(archived, viewer);
      expect(evaluation.visibility).toBe("archived");
      expect(evaluation.isPublic).toBe(false);
      expect(evaluation.httpStatus).toBe(200);
      expect(evaluation.canAccess).toBe(true);
      expect(JSON.stringify(evaluation)).not.toContain("archived-secret");
    }
  });

  it("never includes hidden or archived records in public discovery", () => {
    expect(isPubliclyVisible(hidden)).toBe(false);
    expect(isPubliclyVisible(archived)).toBe(false);
    const filter = buildPublicVisibilityFilter();
    expect(filter.lifecycleState.$nin).toEqual(
      expect.arrayContaining(["hidden", "archived"]),
    );
    expect(filter.moderationStatus.$nin).toEqual(
      expect.arrayContaining(["hidden", "restricted"]),
    );
  });

  it("fails closed if hidden or archive state is stale or contradictory", () => {
    const staleHidden = { ...hidden, moderationStatus: "approved", lifecycleState: "hidden", isActive: true };
    expect(evaluateVisibility(staleHidden).httpStatus).toBe(403);
  });

  it("does not mutate or expose internal prompt content when authorization changes", () => {
    const before = JSON.stringify(hidden);
    evaluateVisibility(hidden);
    evaluateVisibility(hidden, { viewerWallet: OWNER });
    evaluateVisibility(hidden, { viewerWallet: STRANGER });
    expect(JSON.stringify(hidden)).toBe(before);
  });
});
