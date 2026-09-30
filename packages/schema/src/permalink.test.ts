import { describe, it, expect } from "vitest";
import {
  generateSlug,
  buildCanonicalPermalink,
  sanitizePromptRecord,
  PERMALINK_STATUSES,
} from "./permalink.js";

describe("Permalink Schema & Utilities — Issue #936", () => {
  describe("generateSlug", () => {
    it("generates a clean URL slug from standard titles", () => {
      expect(generateSlug("Stellar Smart Contract Auditor")).toBe(
        "stellar-smart-contract-auditor"
      );
      expect(generateSlug("SEO Prompt for Next.js 14")).toBe(
        "seo-prompt-for-nextjs-14"
      );
    });

    it("handles diacritics, symbols, and whitespace", () => {
      expect(generateSlug("  Crème Brûlée & AI Prompts!  ")).toBe(
        "creme-brulee-ai-prompts"
      );
      expect(generateSlug("Prompt #1: Top 10 Features (2026)")).toBe(
        "prompt-1-top-10-features-2026"
      );
    });

    it("collapses multiple consecutive dashes", () => {
      expect(generateSlug("hello --- world --- 123")).toBe("hello-world-123");
    });

    it("handles empty or non-string inputs safely", () => {
      expect(generateSlug("")).toBe("untitled-prompt");
      expect(generateSlug("   ")).toBe("untitled-prompt");
      expect(generateSlug(null as any)).toBe("untitled-prompt");
    });

    it("truncates long titles to 80 chars max", () => {
      const longTitle =
        "This is an extremely long title for an AI prompt that discusses detailed smart contract security audits on the Stellar blockchain";
      const slug = generateSlug(longTitle);
      expect(slug.length).toBeLessThanOrEqual(80);
      expect(slug.endsWith("-")).toBe(false);
    });
  });

  describe("buildCanonicalPermalink", () => {
    it("constructs canonical permalink with id", () => {
      expect(buildCanonicalPermalink({ id: "42" })).toBe("/prompts/42");
      expect(buildCanonicalPermalink({ id: 101 })).toBe("/prompts/101");
    });

    it("respects base URL if provided", () => {
      expect(
        buildCanonicalPermalink({
          id: "42",
          baseUrl: "https://prompthash.stellar.org",
        })
      ).toBe("https://prompthash.stellar.org/prompts/42");
    });
  });

  describe("sanitizePromptRecord — Private Data Leak Prevention", () => {
    it("strictly excludes private content, encryptedPrompt, and moderationNotes", () => {
      const rawPrompt = {
        _id: "660c1234567890abcdef1234",
        onChainId: "42",
        title: "Top Secret Prompt",
        slug: "top-secret-prompt",
        content: "UNAUTHORIZED_LEAK_SECRET_PROMPT_PLAIN_TEXT",
        encryptedPrompt: "CIPHERTEXT_BASE64_SECRET",
        moderationNotes: "Internal note: flagged for review",
        moderationReason: "copyright_check",
        description: "Public description",
        previewText: "Public preview text",
        category: "Programming",
        price: 10,
        owner: {
          walletAddress: "GCREATOR123",
          username: "prompt_creator",
        },
        listingStatus: "published",
        lifecycleState: "published",
      };

      const sanitized: any = sanitizePromptRecord(rawPrompt);

      // Private fields MUST NOT exist
      expect(sanitized.content).toBeUndefined();
      expect(sanitized.encryptedPrompt).toBeUndefined();
      expect(sanitized.moderationNotes).toBeUndefined();

      // Public fields must be preserved
      expect(sanitized.id).toBe("660c1234567890abcdef1234");
      expect(sanitized.onChainId).toBe("42");
      expect(sanitized.title).toBe("Top Secret Prompt");
      expect(sanitized.slug).toBe("top-secret-prompt");
      expect(sanitized.description).toBe("Public description");
      expect(sanitized.previewText).toBe("Public preview text");
      expect(sanitized.creatorWallet).toBe("GCREATOR123");
    });
  });

  describe("PERMALINK_STATUSES", () => {
    it("contains all expected canonical resolution statuses", () => {
      expect(PERMALINK_STATUSES).toContain("active");
      expect(PERMALINK_STATUSES).toContain("redirect");
      expect(PERMALINK_STATUSES).toContain("archived");
      expect(PERMALINK_STATUSES).toContain("restricted");
      expect(PERMALINK_STATUSES).toContain("deleted");
      expect(PERMALINK_STATUSES).toContain("not_found");
    });
  });
});
