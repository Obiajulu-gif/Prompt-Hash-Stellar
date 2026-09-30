import { describe, it, expect } from "vitest";
import {
  calculateRelevanceScore,
  rankPrompts,
  generateNoResultSuggestions,
} from "./rankingEngine";
import type { PromptRecord } from "@/lib/stellar/promptHashClient";

const mockPrompt = (overrides: Partial<PromptRecord> = {}): PromptRecord => ({
  id: 1n,
  creator: "creator1",
  priceStroops: 1000n,
  title: "Test Prompt",
  category: "Software Development",
  previewText: "A test prompt preview",
  description: "Detailed description",
  tags: ["AI", "Development"],
  imageUrl: "https://example.com/image.png",
  salesCount: 5,
  active: true,
  contentHash: "hash123",
  ...overrides,
});

describe("rankingEngine", () => {
  describe("calculateRelevanceScore", () => {
    it("should give highest score for exact title match", () => {
      const prompt = mockPrompt({ title: "Architecture Review" });
      const result = calculateRelevanceScore(prompt, "Architecture Review", "");
      expect(result.score).toBe(100);
      expect(result.titleMatch).toBe(true);
    });

    it("should give high score for title start match", () => {
      const prompt = mockPrompt({ title: "Architecture Review Sprint" });
      const result = calculateRelevanceScore(prompt, "Architecture", "");
      expect(result.score).toBe(80);
      expect(result.titleMatch).toBe(true);
    });

    it("should give medium score for title contains match", () => {
      const prompt = mockPrompt({
        title: "Complete Architecture Design Review",
      });
      const result = calculateRelevanceScore(prompt, "Architecture", "");
      expect(result.score).toBe(60);
      expect(result.titleMatch).toBe(true);
    });

    it("should boost score for category match", () => {
      const prompt = mockPrompt({ category: "Architecture Services" });
      const result = calculateRelevanceScore(
        prompt,
        "Architecture",
        "Software Development",
      );
      expect(result.categoryMatch).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });

    it("should return 0 score with no search query", () => {
      const prompt = mockPrompt({ title: "Architecture Review" });
      const result = calculateRelevanceScore(prompt, "", "");
      expect(result.score).toBe(0);
    });
  });

  describe("rankPrompts", () => {
    it("should rank title matches higher than other matches", () => {
      const titleMatch = mockPrompt({ title: "Architecture Review", id: 1n });
      const descriptionMatch = mockPrompt({
        title: "Database Design",
        description: "This covers architecture concepts",
        id: 2n,
      });

      const ranked = rankPrompts(
        [descriptionMatch, titleMatch],
        "Architecture",
        "",
      );
      expect(ranked[0].id).toBe(titleMatch.id);
      expect(ranked[1].id).toBe(descriptionMatch.id);
    });

    it("should not reorder when no search query", () => {
      const prompt1 = mockPrompt({ id: 1n });
      const prompt2 = mockPrompt({ id: 2n });
      const original = [prompt1, prompt2];
      const ranked = rankPrompts([...original], "", "");
      expect(ranked).toEqual(original);
    });
  });

  describe("generateNoResultSuggestions", () => {
    it("should suggest clearing filters", () => {
      const prompts = [mockPrompt()];
      const suggestions = generateNoResultSuggestions(
        prompts,
        "search",
        "Software Development",
        "AI",
      );
      expect(suggestions.some((s) => s.type === "clear")).toBe(true);
    });

    it("should suggest popular categories", () => {
      const prompts = [
        mockPrompt({ category: "Marketing", id: 1n }),
        mockPrompt({ category: "Marketing", id: 2n }),
        mockPrompt({ category: "Sales", id: 3n }),
      ];
      const suggestions = generateNoResultSuggestions(
        prompts,
        "search",
        "",
        "",
      );
      const categoryCount = suggestions.filter(
        (s) => s.type === "category",
      ).length;
      expect(categoryCount).toBeGreaterThan(0);
    });
  });
});
