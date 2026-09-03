import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchPrompts, rebuildSearchIndex } from "../controllers/searchController";

// Mock dependencies
vi.mock("../models/Prompt", () => {
  const mockPrompts = [
    {
      _id: "prompt-1",
      title: "React Component Architect",
      category: "Software Development",
      content: "Generate clean TypeScript React components",
      description: "Production-ready prompt with storybook integration",
      tags: ["react", "typescript", "frontend"],
      price: 25,
      rating: 4.9,
      salesCount: 35,
      currentVersionIndex: 2,
      isActive: true,
      listingStatus: "published",
      owner: {
        walletAddress: "GCREATOR1",
        username: "creator_one",
        rating: 4.8,
      },
    },
    {
      _id: "prompt-2",
      title: "SEO Copywriter Pro",
      category: "Marketing",
      content: "Write high converting blog posts",
      description: "SEO optimized content structure",
      tags: ["seo", "copywriting", "marketing"],
      price: 15,
      rating: 4.6,
      salesCount: 50,
      currentVersionIndex: 1,
      isActive: true,
      listingStatus: "published",
      owner: {
        walletAddress: "GCREATOR2",
        username: "creator_two",
        rating: 4.5,
      },
    },
  ];

  return {
    default: {
      find: vi.fn(() => ({
        or: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        populate: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(mockPrompts),
        getFilter: vi.fn().mockReturnValue({}),
        then: (resolve: any) => Promise.resolve(mockPrompts).then(resolve),
      })),
      countDocuments: vi.fn().mockResolvedValue(mockPrompts.length),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
    },
  };
});

vi.mock("../services/cacheService", () => ({
  cacheGetJson: vi.fn().mockResolvedValue(null),
  cacheSetJson: vi.fn().mockResolvedValue(undefined),
  cacheDelPattern: vi.fn().mockResolvedValue(undefined),
  CACHE_KEYS: {
    searchResults: (key: string) => `search:signals:${key}`,
    searchSuggestions: (key: string) => `search:suggestions:${key}`,
    categories: () => "prompts:categories",
    featuredPrompts: (limit: number) => `prompts:featured:${limit}`,
  },
  DEFAULT_TTL_SECONDS: 60,
  CATEGORY_TTL_SECONDS: 600,
}));

describe("Marketplace Search Signals & Index Rebuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should support search queries across tags, version, and trust signals", async () => {
    const result = await searchPrompts({
      query: "typescript",
      tags: "react",
      minVersion: 1,
      minCreatorRating: 4.0,
    });

    expect(result.prompts).toBeDefined();
    expect(result.total).toBe(2);
    expect(result.prompts[0].tags).toContain("react");
  });

  it("should deterministically rebuild search index across published listings", async () => {
    const rebuildResult = await rebuildSearchIndex();

    expect(rebuildResult.success).toBe(true);
    expect(rebuildResult.rebuiltAt).toBeDefined();
  });
});
