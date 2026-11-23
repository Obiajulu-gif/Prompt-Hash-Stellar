import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateVisibility,
  isPubliclyVisible,
  buildPublicVisibilityFilter,
  stripSensitivePromptFields,
  sanitizeRelationshipNode,
} from "./visibility.ts";

describe("Core Visibility Rules — Issue #913", () => {
  const publicPrompt = {
    _id: "p_pub_1",
    onChainId: "101",
    title: "Awesome Soroban Code Generator",
    isActive: true,
    listingStatus: "published",
    lifecycleState: "published",
    visibility: "public",
    moderationStatus: "none",
    owner: { walletAddress: "GBZ11111111111111111111111111111111111111111111111111111111" },
    content: "SECRET_PROMPT_TEMPLATE",
    encryptedPrompt: "CIPHERTEXT",
  };

  const privatePrompt = {
    _id: "p_priv_1",
    onChainId: "102",
    title: "Private Financial Analysis Prompt",
    isActive: true,
    listingStatus: "published",
    lifecycleState: "published",
    visibility: "private",
    moderationStatus: "none",
    owner: { walletAddress: "GBZ11111111111111111111111111111111111111111111111111111111" },
    content: "SECRET_PRIVATE_TEMPLATE",
  };

  const draftPrompt = {
    _id: "p_draft_1",
    onChainId: "103",
    title: "Draft Prompt In Progress",
    isActive: false,
    listingStatus: "draft",
    lifecycleState: "draft",
    moderationStatus: "none",
    owner: { walletAddress: "GBZ11111111111111111111111111111111111111111111111111111111" },
  };

  const restrictedPrompt = {
    _id: "p_rest_1",
    onChainId: "104",
    title: "Restricted Violation Prompt",
    isActive: false,
    listingStatus: "published",
    lifecycleState: "suspended",
    moderationStatus: "restricted",
    owner: { walletAddress: "GBZ11111111111111111111111111111111111111111111111111111111" },
  };

  const deletedPrompt = {
    _id: "p_del_1",
    onChainId: "105",
    title: "Deleted Legacy Prompt",
    isDeleted: true,
    deletedAt: new Date(),
    owner: { walletAddress: "GBZ11111111111111111111111111111111111111111111111111111111" },
  };

  const archivedPrompt = {
    _id: "p_arch_1",
    onChainId: "106",
    title: "Archived Campaign Prompt",
    isActive: false,
    listingStatus: "archived",
    lifecycleState: "archived",
    archivedAt: new Date(),
    owner: { walletAddress: "GBZ11111111111111111111111111111111111111111111111111111111" },
  };

  describe("evaluateVisibility & isPubliclyVisible", () => {
    it("correctly identifies clean public listings", () => {
      const evaluation = evaluateVisibility(publicPrompt);
      assert.equal(evaluation.visibility, "public");
      assert.equal(evaluation.isPublic, true);
      assert.equal(evaluation.canAccess, true);
      assert.equal(evaluation.httpStatus, 200);
      assert.equal(isPubliclyVisible(publicPrompt), true);
    });

    it("evaluates private listings and prevents anonymous public access", () => {
      const anonEval = evaluateVisibility(privatePrompt);
      assert.equal(anonEval.visibility, "private");
      assert.equal(anonEval.isPublic, false);
      assert.equal(anonEval.canAccess, false);
      assert.equal(anonEval.httpStatus, 404);
      assert.equal(isPubliclyVisible(privatePrompt), false);

      // Owner should have access
      const ownerEval = evaluateVisibility(privatePrompt, {
        viewerWallet: "GBZ11111111111111111111111111111111111111111111111111111111",
      });
      assert.equal(ownerEval.visibility, "private");
      assert.equal(ownerEval.canAccess, true);
      assert.equal(ownerEval.httpStatus, 200);

      // Other wallet should NOT have access
      const strangerEval = evaluateVisibility(privatePrompt, {
        viewerWallet: "GBZ22222222222222222222222222222222222222222222222222222222",
      });
      assert.equal(strangerEval.canAccess, false);
      assert.equal(strangerEval.httpStatus, 404);
    });

    it("evaluates draft listings as private", () => {
      const evalDraft = evaluateVisibility(draftPrompt);
      assert.equal(evalDraft.visibility, "private");
      assert.equal(evalDraft.isPublic, false);
      assert.equal(isPubliclyVisible(draftPrompt), false);
    });

    it("evaluates restricted records with 403 status and blocks unauthorized callers", () => {
      const anonEval = evaluateVisibility(restrictedPrompt);
      assert.equal(anonEval.visibility, "restricted");
      assert.equal(anonEval.isPublic, false);
      assert.equal(anonEval.canAccess, false);
      assert.equal(anonEval.httpStatus, 403);

      // Moderator has access for review
      const modEval = evaluateVisibility(restrictedPrompt, { role: "moderator" });
      assert.equal(modEval.canAccess, true);
      assert.equal(modEval.httpStatus, 200);

      // Admin has access
      const adminEval = evaluateVisibility(restrictedPrompt, { role: "admin" });
      assert.equal(adminEval.canAccess, true);
      assert.equal(adminEval.httpStatus, 200);
    });

    it("evaluates deleted records with 410 status and blocks all public paths", () => {
      const evalDel = evaluateVisibility(deletedPrompt);
      assert.equal(evalDel.visibility, "deleted");
      assert.equal(evalDel.isPublic, false);
      assert.equal(evalDel.canAccess, false);
      assert.equal(evalDel.httpStatus, 410);
      assert.equal(isPubliclyVisible(deletedPrompt), false);
    });

    it("evaluates archived records as non-public for marketplace search", () => {
      const evalArch = evaluateVisibility(archivedPrompt);
      assert.equal(evalArch.visibility, "archived");
      assert.equal(evalArch.isPublic, false);
      assert.equal(isPubliclyVisible(archivedPrompt), false);
    });
  });

  describe("buildPublicVisibilityFilter", () => {
    it("returns comprehensive filter matching all public boundary requirements", () => {
      const filter = buildPublicVisibilityFilter();
      assert.deepEqual(filter.isDeleted, { $ne: true });
      assert.equal(filter.deletedAt, null);
      assert.equal(filter.isActive, true);
      assert.equal(filter.listingStatus, "published");
      assert.deepEqual(filter.visibility, { $ne: "private" });
      assert.ok(filter.lifecycleState.$nin.includes("draft"));
      assert.ok(filter.lifecycleState.$nin.includes("suspended"));
      assert.ok(filter.lifecycleState.$nin.includes("archived"));
      assert.ok(filter.moderationStatus.$nin.includes("restricted"));
      assert.ok(filter.moderationStatus.$nin.includes("hidden"));
    });
  });

  describe("stripSensitivePromptFields", () => {
    it("removes plaintext content, ciphertext, and internal notes", () => {
      const stripped = stripSensitivePromptFields({
        ...publicPrompt,
        moderationNotes: "INTERNAL NOTE",
        integrityError: "FAILED HASH",
      });
      assert.equal((stripped as any).content, undefined);
      assert.equal((stripped as any).encryptedPrompt, undefined);
      assert.equal((stripped as any).moderationNotes, undefined);
      assert.equal((stripped as any).integrityError, undefined);
      assert.equal((stripped as any).title, "Awesome Soroban Code Generator");
    });
  });

  describe("sanitizeRelationshipNode", () => {
    it("returns title and link for public node", () => {
      const node = sanitizeRelationshipNode(publicPrompt);
      assert.equal(node.visibility, "public");
      assert.equal(node.title, "Awesome Soroban Code Generator");
      assert.equal(node.link, "/prompts/101");
      assert.equal(node.isRedacted, false);
    });

    it("redacts title and link for private node to public viewers", () => {
      const node = sanitizeRelationshipNode(privatePrompt);
      assert.equal(node.visibility, "private");
      assert.equal(node.title, null);
      assert.equal(node.link, null);
      assert.equal(node.isRedacted, true);
    });

    it("redacts title and link for restricted node to public viewers", () => {
      const node = sanitizeRelationshipNode(restrictedPrompt);
      assert.equal(node.visibility, "restricted");
      assert.equal(node.title, null);
      assert.equal(node.link, null);
      assert.equal(node.isRedacted, true);
    });

    it("redacts title and link for deleted node", () => {
      const node = sanitizeRelationshipNode(deletedPrompt);
      assert.equal(node.visibility, "deleted");
      assert.equal(node.title, null);
      assert.equal(node.link, null);
      assert.equal(node.isRedacted, true);
    });
  });
});
