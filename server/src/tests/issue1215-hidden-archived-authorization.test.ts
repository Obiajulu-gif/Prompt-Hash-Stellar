import { describe, expect, it } from "vitest";
import { evaluateVisibility } from "../../../packages/schema/src/visibility.js";
import { enforceRecordVisibility } from "../services/visibilityService.js";

const OWNER = "G" + "A".repeat(55);
const STRANGER = "G" + "B".repeat(55);

const hidden = {
  _id: "hidden-1215",
  owner: { walletAddress: OWNER },
  moderationStatus: "hidden",
  lifecycleState: "hidden",
  listingStatus: "published",
  title: "Hidden prompt",
  content: "private content",
  encryptedPrompt: "ciphertext",
};

const archived = {
  _id: "archived-1215",
  owner: { walletAddress: OWNER },
  listingStatus: "archived",
  lifecycleState: "archived",
  archivedAt: new Date("2026-01-01"),
  title: "Archived prompt",
  content: "old content",
};

describe("issue #1215 hidden and archived authorization", () => {
  it("allows the owner and moderator to inspect hidden records, not strangers", () => {
    expect(evaluateVisibility(hidden, { viewerWallet: OWNER }).canAccess).toBe(true);
    expect(evaluateVisibility(hidden, { role: "moderator" }).canAccess).toBe(true);
    expect(evaluateVisibility(hidden, { viewerWallet: STRANGER }).canAccess).toBe(false);
    expect(enforceRecordVisibility(hidden, { viewerWallet: STRANGER }).httpStatus).toBe(403);
  });

  it("redacts sensitive fields for an authorized hidden-record response", () => {
    const result = enforceRecordVisibility(hidden, { viewerWallet: OWNER });
    expect(result.allowed).toBe(true);
    expect(result.record).toMatchObject({ _id: "hidden-1215", title: "Hidden prompt" });
    expect(result.record).not.toHaveProperty("content");
    expect(result.record).not.toHaveProperty("encryptedPrompt");
  });

  it("returns archived records as safe tombstones without granting purchase data", () => {
    const result = enforceRecordVisibility(archived, { viewerWallet: STRANGER });
    expect(result.allowed).toBe(true);
    expect(result.visibility).toBe("archived");
    expect(result.record).toMatchObject({ _id: "archived-1215", title: "Archived prompt" });
    expect(result.record).not.toHaveProperty("content");
  });
});
