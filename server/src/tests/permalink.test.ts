/**
 * Tests — Safe Public Permalinks & Redirects (#936)
 *
 * Coverage:
 *  - Canonical permalink and redirect behavior:
 *    - Rename: updates slug, preserves old slug, resolves to 301 redirect.
 *    - Multiple renames: collapses previous slugs directly to latest canonical URL.
 *  - Archive:
 *    - Transitions to archived state.
 *    - Public link returns safe archived tombstone/banner.
 *    - Zero private data (content/encryptedPrompt/moderationNotes) leaked.
 *  - Restore:
 *    - Restores archived record back to active published state.
 *    - Reactivates canonical permalink.
 *  - Delete / Restrict:
 *    - Delete sets isDeleted, returns 410 Gone with zero record content.
 *    - Restrict sets moderationStatus/lifecycleState.
 *    - Restricted records NEVER leak private data through old links or canonical links.
 *  - Unauthorized access:
 *    - Public / third-party requests are blocked from restricted records (403).
 *    - Private prompt content is never leaked to unauthorized callers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Model mocks ────────────────────────────────────────────────────────────────
vi.mock("../models/Prompt.js", () => ({
  default: {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock("../services/auditTrail.js", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/structuredLogger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Prompt from "../models/Prompt.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import {
  renameRecord,
  archiveRecord,
  restoreRecord,
  restrictRecord,
  deleteRecord,
  resolvePermalink,
  generateSlug,
  buildCanonicalPermalink,
} from "../services/permalinkService.js";

describe("Safe Public Permalinks Service — Issue #936", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Canonical Slug & Permalink Building", () => {
    it("generates consistent, clean URL slugs", () => {
      expect(generateSlug("Stellar Smart Contract Auditor v2")).toBe(
        "stellar-smart-contract-auditor-v2"
      );
      expect(generateSlug("Python & Rust Prompt #42")).toBe("python-rust-prompt-42");
    });

    it("builds canonical permalink paths based on id", () => {
      expect(buildCanonicalPermalink({ id: "100" })).toBe("/prompts/100");
    });
  });

  describe("1. Record Renaming & Safe 301 Redirects", () => {
    it("renames a record, records old slug in previousSlugs, and logs audit event", async () => {
      const mockPrompt: any = {
        _id: "660c0001",
        onChainId: "42",
        title: "Old Prompt Title",
        slug: "old-prompt-title",
        previousSlugs: [],
        redirectsFrom: [],
        canonicalUrl: "/prompts/42",
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(mockPrompt);

      const result = await renameRecord({
        promptId: "42",
        newTitle: "New Amazing Prompt Title",
        reason: "Marketing rebrand",
        actor: { role: "creator", id: "GCREATOR_WALLET" },
      });

      expect(result.title).toBe("New Amazing Prompt Title");
      expect(result.slug).toBe("new-amazing-prompt-title");
      expect(result.previousSlugs).toContain("old-prompt-title");
      expect(result.redirectsFrom).toContain("old-prompt-title");
      expect(result.canonicalUrl).toBe("/prompts/42");
      expect(mockPrompt.save).toHaveBeenCalled();

      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "prompt_permalink_renamed",
          result: "success",
          promptId: "42",
          walletAddress: "GCREATOR_WALLET",
          reason: "Marketing rebrand",
        })
      );
    });

    it("safely resolves old slug to HTTP 301 redirect pointing to canonical URL", async () => {
      const renamedPrompt: any = {
        _id: "660c0001",
        onChainId: "42",
        title: "New Amazing Prompt Title",
        slug: "new-amazing-prompt-title",
        previousSlugs: ["old-prompt-title", "v1-prompt-title"],
        redirectsFrom: ["old-prompt-title", "v1-prompt-title"],
        canonicalUrl: "/prompts/42",
        listingStatus: "published",
        lifecycleState: "published",
        isActive: true,
        populate: vi.fn().mockReturnThis(),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(renamedPrompt);

      // Caller requests via the OLD slug
      const resolution = await resolvePermalink("old-prompt-title");

      expect(resolution.status).toBe("redirect");
      expect(resolution.statusCode).toBe(301);
      expect(resolution.canonicalUrl).toBe("/prompts/42");
      expect(resolution.targetSlug).toBe("new-amazing-prompt-title");
      expect(resolution.targetId).toBe("42");
    });

    it("resolves current canonical slug to active 200 record", async () => {
      const activePrompt: any = {
        _id: "660c0001",
        onChainId: "42",
        title: "New Amazing Prompt Title",
        slug: "new-amazing-prompt-title",
        previousSlugs: ["old-prompt-title"],
        canonicalUrl: "/prompts/42",
        listingStatus: "published",
        lifecycleState: "published",
        isActive: true,
        category: "Programming",
        price: 25,
        populate: vi.fn().mockReturnThis(),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(activePrompt);

      const resolution = await resolvePermalink("new-amazing-prompt-title");

      expect(resolution.status).toBe("active");
      expect(resolution.statusCode).toBe(200);
      expect(resolution.canonicalUrl).toBe("/prompts/42");
      expect(resolution.record?.title).toBe("New Amazing Prompt Title");
    });
  });

  describe("2. Archive Record & Private Data Leak Prevention", () => {
    it("archives a record and transitions lifecycle safely", async () => {
      const mockPrompt: any = {
        _id: "660c0002",
        onChainId: "50",
        title: "Prompt to Archive",
        slug: "prompt-to-archive",
        listingStatus: "published",
        lifecycleState: "published",
        isActive: true,
        archivedAt: null,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(mockPrompt);

      const result = await archiveRecord({
        promptId: "50",
        actor: { role: "creator", id: "GCREATOR_WALLET" },
        reason: "Author retired prompt",
      });

      expect(result.listingStatus).toBe("archived");
      expect(result.lifecycleState).toBe("archived");
      expect(result.isActive).toBe(false);
      expect(result.archivedAt).toBeInstanceOf(Date);
      expect(mockPrompt.save).toHaveBeenCalled();

      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "prompt_permalink_archived",
          result: "success",
          promptId: "50",
        })
      );
    });

    it("public permalink to archived record returns safe archived notice without leaking private data", async () => {
      const archivedPrompt: any = {
        _id: "660c0002",
        onChainId: "50",
        title: "Archived Prompt",
        slug: "archived-prompt",
        content: "PRIVATE_PAID_PROMPT_CONTENT_LEAK_TARGET",
        encryptedPrompt: "ENCRYPTED_SECRET_CIPHERTEXT",
        moderationNotes: "INTERNAL_MODERATOR_SECRET_NOTE",
        listingStatus: "archived",
        lifecycleState: "archived",
        isActive: false,
        archivedAt: new Date("2026-01-01"),
        canonicalUrl: "/prompts/50",
        populate: vi.fn().mockReturnThis(),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(archivedPrompt);

      const resolution = await resolvePermalink("50");

      expect(resolution.status).toBe("archived");
      expect(resolution.statusCode).toBe(200);
      expect(resolution.isArchived).toBe(true);

      // Verify ZERO private data leak
      expect((resolution.record as any)?.content).toBeUndefined();
      expect((resolution.record as any)?.encryptedPrompt).toBeUndefined();
      expect((resolution.record as any)?.moderationNotes).toBeUndefined();

      // Safe public fields must be present
      expect(resolution.record?.title).toBe("Archived Prompt");
      expect(resolution.record?.canonicalUrl).toBe("/prompts/50");
    });

    it("old link to an archived record redirects safely to canonical URL with archived flag", async () => {
      const renamedArchivedPrompt: any = {
        _id: "660c0002",
        onChainId: "50",
        title: "New Title Archived Prompt",
        slug: "new-title-archived-prompt",
        previousSlugs: ["old-unarchived-slug"],
        redirectsFrom: ["old-unarchived-slug"],
        listingStatus: "archived",
        lifecycleState: "archived",
        isActive: false,
        canonicalUrl: "/prompts/50",
        populate: vi.fn().mockReturnThis(),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(renamedArchivedPrompt);

      const resolution = await resolvePermalink("old-unarchived-slug");

      expect(resolution.status).toBe("redirect");
      expect(resolution.statusCode).toBe(301);
      expect(resolution.canonicalUrl).toBe("/prompts/50");
      expect(resolution.isArchived).toBe(true);
    });
  });

  describe("3. Restore Record", () => {
    it("restores an archived record back to active published state", async () => {
      const archivedPrompt: any = {
        _id: "660c0003",
        onChainId: "60",
        title: "Restorable Prompt",
        slug: "restorable-prompt",
        listingStatus: "archived",
        lifecycleState: "archived",
        isActive: false,
        archivedAt: new Date(),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(archivedPrompt);

      const restored = await restoreRecord({
        promptId: "60",
        actor: { role: "creator", id: "GCREATOR_WALLET" },
        reason: "Relisted by creator",
      });

      expect(restored.listingStatus).toBe("published");
      expect(restored.lifecycleState).toBe("published");
      expect(restored.isActive).toBe(true);
      expect(restored.archivedAt).toBeNull();
      expect(archivedPrompt.save).toHaveBeenCalled();

      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "prompt_permalink_restored",
          result: "success",
          promptId: "60",
        })
      );
    });
  });

  describe("4. Delete Record", () => {
    it("marks record as deleted and resolves to HTTP 410 Gone without leaking data", async () => {
      const activePrompt: any = {
        _id: "660c0004",
        onChainId: "70",
        title: "Delete Me",
        slug: "delete-me",
        isDeleted: false,
        deletedAt: null,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(activePrompt);

      const deleted = await deleteRecord({
        promptId: "70",
        actor: { role: "admin", id: "GADMIN_WALLET" },
        reason: "User requested account deletion",
      });

      expect(deleted.isDeleted).toBe(true);
      expect(deleted.deletedAt).toBeInstanceOf(Date);
      expect(deleted.isActive).toBe(false);

      // Now resolve permalink for deleted record
      const deletedDoc: any = {
        ...deleted,
        canonicalUrl: "/prompts/70",
        populate: vi.fn().mockReturnThis(),
      };
      vi.mocked(Prompt.findOne).mockResolvedValue(deletedDoc);

      const resolution = await resolvePermalink("70");
      expect(resolution.status).toBe("deleted");
      expect(resolution.statusCode).toBe(410);
      expect(resolution.record).toBeUndefined(); // Zero record content
    });
  });

  describe("5. Restricted Records — Critical Private Data Leak Prevention", () => {
    it("restricts a record through moderation action and logs audit", async () => {
      const promptToRestrict: any = {
        _id: "660c0005",
        onChainId: "80",
        title: "Policy Violating Prompt",
        slug: "policy-violating-prompt",
        moderationStatus: "none",
        lifecycleState: "published",
        isActive: true,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(promptToRestrict);

      const restricted = await restrictRecord({
        promptId: "80",
        actor: { role: "moderator", id: "GMOD_WALLET" },
        reasonCode: "hate_speech",
        notes: "Violates safety terms",
      });

      expect(restricted.moderationStatus).toBe("restricted");
      expect(restricted.lifecycleState).toBe("suspended");
      expect(restricted.isActive).toBe(false);
      expect(restricted.moderationReason).toBe("hate_speech");
      expect(restricted.moderationNotes).toBe("Violates safety terms");

      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "prompt_permalink_restricted",
          result: "success",
          promptId: "80",
        })
      );
    });

    it("public access to restricted record returns 403 Forbidden with ZERO private data", async () => {
      const restrictedPrompt: any = {
        _id: "660c0005",
        onChainId: "80",
        title: "Policy Violating Prompt",
        slug: "policy-violating-prompt",
        content: "CONFIDENTIAL_PRIVATE_CONTENT",
        encryptedPrompt: "CONFIDENTIAL_CIPHERTEXT",
        moderationNotes: "SECRET_MOD_FLAGS",
        moderationStatus: "restricted",
        lifecycleState: "suspended",
        isActive: false,
        canonicalUrl: "/prompts/80",
        owner: { walletAddress: "GCREATOR_WALLET" },
        populate: vi.fn().mockReturnThis(),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(restrictedPrompt);

      // Public unauthorized viewer requests canonical URL
      const resolution = await resolvePermalink("80", {
        viewerWallet: "GUNAUTHORIZED_BUYER_WALLET",
      });

      expect(resolution.status).toBe("restricted");
      expect(resolution.statusCode).toBe(403);
      expect(resolution.isRestricted).toBe(true);
      expect(resolution.record).toBeUndefined(); // ZERO private record data leaked
    });

    it("CRITICAL: restricted records DO NOT LEAK through old links / previous slugs", async () => {
      const restrictedPromptWithHistory: any = {
        _id: "660c0005",
        onChainId: "80",
        title: "Renamed Then Restricted Prompt",
        slug: "renamed-then-restricted",
        previousSlugs: ["old-friendly-slug-before-malicious-edit"],
        redirectsFrom: ["old-friendly-slug-before-malicious-edit"],
        content: "CONFIDENTIAL_PRIVATE_CONTENT",
        encryptedPrompt: "CONFIDENTIAL_CIPHERTEXT",
        moderationNotes: "SECRET_MOD_FLAGS",
        moderationStatus: "restricted",
        lifecycleState: "suspended",
        isActive: false,
        canonicalUrl: "/prompts/80",
        owner: { walletAddress: "GCREATOR_WALLET" },
        populate: vi.fn().mockReturnThis(),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(restrictedPromptWithHistory);

      // Attacker or user visits the OLD link hoping to bypass restriction or see private cache
      const resolution = await resolvePermalink(
        "old-friendly-slug-before-malicious-edit",
        { viewerWallet: "GATTACKER_WALLET" }
      );

      // MUST NOT return redirect or record content! Must block access!
      expect(resolution.status).toBe("restricted");
      expect(resolution.statusCode).toBe(403);
      expect(resolution.isRestricted).toBe(true);
      expect(resolution.record).toBeUndefined();
    });

    it("allows authorized creator to view their own restricted record status with sanitized metadata", async () => {
      const restrictedPrompt: any = {
        _id: "660c0005",
        onChainId: "80",
        title: "Policy Violating Prompt",
        slug: "policy-violating-prompt",
        content: "CONFIDENTIAL_PRIVATE_CONTENT",
        encryptedPrompt: "CONFIDENTIAL_CIPHERTEXT",
        moderationNotes: "INTERNAL_MOD_NOTES",
        moderationStatus: "restricted",
        lifecycleState: "suspended",
        isActive: false,
        canonicalUrl: "/prompts/80",
        owner: { walletAddress: "GCREATOR_WALLET" },
        populate: vi.fn().mockReturnThis(),
      };

      vi.mocked(Prompt.findOne).mockResolvedValue(restrictedPrompt);

      // Creator visits their own restricted listing
      const resolution = await resolvePermalink("80", {
        viewerWallet: "GCREATOR_WALLET",
      });

      expect(resolution.status).toBe("restricted");
      expect(resolution.statusCode).toBe(403);
      expect(resolution.isRestricted).toBe(true);
      expect(resolution.record?.title).toBe("Policy Violating Prompt");

      // Even for owner, raw unpurchased plaintext content is NOT leaked through permalink
      expect((resolution.record as any)?.content).toBeUndefined();
      expect((resolution.record as any)?.encryptedPrompt).toBeUndefined();
      expect((resolution.record as any)?.moderationNotes).toBeUndefined();
    });
  });

  describe("6. Not Found Records", () => {
    it("returns 404 not_found when no record matches identifier", async () => {
      vi.mocked(Prompt.findOne).mockResolvedValue(null);

      const resolution = await resolvePermalink("non-existent-prompt-id-9999");
      expect(resolution.status).toBe("not_found");
      expect(resolution.statusCode).toBe(404);
      expect(resolution.canonicalUrl).toBe("");
    });
  });
});
