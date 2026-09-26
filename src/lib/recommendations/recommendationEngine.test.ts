import { describe, expect, it } from "vitest";
import {
  isPromptEligibleForRecommendation,
  calculateRecommendationScore,
  getRecommendedPrompts,
  PromptListing,
} from "./recommendationEngine";

describe("Recommendation Engine Eligibility", () => {
  const basePrompt: PromptListing = {
    id: "prompt-1",
    title: "AI SEO Generator",
    category: "Marketing",
    price: 15,
    rating: 4.8,
    salesCount: 20,
    createdAt: new Date().toISOString(),
    ownerId: "user-creator-1",
    ownerWallet: "GCREATOR111111111111111111111111111111111111111111111111",
    creatorTrustScore: 4.5,
    creatorRating: 4.5,
    listingStatus: "published",
    isActive: true,
    similarityFlag: "clean",
    integrityStatus: "ok",
  };

  it("considers valid active prompts eligible", () => {
    expect(isPromptEligibleForRecommendation(basePrompt)).toBe(true);
  });

  it("excludes owned prompts for the creator", () => {
    expect(
      isPromptEligibleForRecommendation(basePrompt, {
        userId: "user-creator-1",
      }),
    ).toBe(false);

    expect(
      isPromptEligibleForRecommendation(basePrompt, {
        userWallet: "GCREATOR111111111111111111111111111111111111111111111111",
      }),
    ).toBe(false);
  });

  it("excludes already purchased prompts", () => {
    expect(
      isPromptEligibleForRecommendation(basePrompt, {
        purchasedPromptIds: ["prompt-1"],
      }),
    ).toBe(false);

    expect(
      isPromptEligibleForRecommendation(basePrompt, {
        purchasedPromptIds: new Set(["prompt-1"]),
      }),
    ).toBe(false);
  });

  it("excludes hidden, archived, draft, or inactive prompts", () => {
    expect(
      isPromptEligibleForRecommendation({ ...basePrompt, isActive: false }),
    ).toBe(false);
    expect(
      isPromptEligibleForRecommendation({ ...basePrompt, listingStatus: "draft" }),
    ).toBe(false);
    expect(
      isPromptEligibleForRecommendation({ ...basePrompt, listingStatus: "archived" }),
    ).toBe(false);
    expect(
      isPromptEligibleForRecommendation({ ...basePrompt, isHidden: true }),
    ).toBe(false);
    expect(
      isPromptEligibleForRecommendation({ ...basePrompt, isRestricted: true }),
    ).toBe(false);
  });

  it("excludes highly similar or corrupted prompts", () => {
    expect(
      isPromptEligibleForRecommendation({
        ...basePrompt,
        similarityFlag: "highly_similar",
      }),
    ).toBe(false);
    expect(
      isPromptEligibleForRecommendation({
        ...basePrompt,
        integrityStatus: "corrupted",
      }),
    ).toBe(false);
  });

  it("excludes stale prompts without recent activity", () => {
    const twoYearsAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    expect(
      isPromptEligibleForRecommendation({
        ...basePrompt,
        createdAt: twoYearsAgo.toISOString(),
        updatedAt: twoYearsAgo.toISOString(),
      }),
    ).toBe(false);
  });

  it("excludes low-trust creators", () => {
    expect(
      isPromptEligibleForRecommendation({
        ...basePrompt,
        creatorTrustScore: 1.2,
      }),
    ).toBe(false);
    expect(
      isPromptEligibleForRecommendation({
        ...basePrompt,
        creatorRating: 1.5,
      }),
    ).toBe(false);
  });
});

describe("Deterministic Ranking and Category Diversity", () => {
  const samplePrompts: PromptListing[] = [
    {
      id: "p1",
      title: "Marketing Strategy",
      category: "Marketing",
      price: 10,
      rating: 5.0,
      salesCount: 50,
      createdAt: new Date().toISOString(),
      ownerId: "c1",
      creatorTrustScore: 5.0,
      listingStatus: "published",
      isActive: true,
    },
    {
      id: "p2",
      title: "Marketing Copywriter",
      category: "Marketing",
      price: 12,
      rating: 4.9,
      salesCount: 40,
      createdAt: new Date().toISOString(),
      ownerId: "c2",
      creatorTrustScore: 4.8,
      listingStatus: "published",
      isActive: true,
    },
    {
      id: "p3",
      title: "Fullstack Architecture Review",
      category: "Software Development",
      price: 20,
      rating: 4.9,
      salesCount: 30,
      createdAt: new Date().toISOString(),
      ownerId: "c3",
      creatorTrustScore: 4.9,
      listingStatus: "published",
      isActive: true,
    },
    {
      id: "p4",
      title: "Sales Discovery Closer",
      category: "Sales",
      price: 15,
      rating: 4.7,
      salesCount: 20,
      createdAt: new Date().toISOString(),
      ownerId: "c4",
      creatorTrustScore: 4.6,
      listingStatus: "published",
      isActive: true,
    },
  ];

  it("scores prompts deterministically", () => {
    const score1 = calculateRecommendationScore(samplePrompts[0]);
    const score2 = calculateRecommendationScore(samplePrompts[0]);
    expect(score1).toBe(score2);
    expect(score1).toBeGreaterThan(0);
  });

  it("interleaves categories when category diversity is enabled", () => {
    const recommended = getRecommendedPrompts(samplePrompts, {
      categoryDiversity: true,
      limit: 3,
    });

    const categories = recommended.map((p) => p.category);
    // Unique categories represented across first selections
    expect(new Set(categories).size).toBeGreaterThanOrEqual(2);
  });
});
