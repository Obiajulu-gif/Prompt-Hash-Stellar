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
      })),
      countDocuments: vi.fn().mockResolvedValue(mockPrompts.length),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
    },
  };
});

vi.mock("../services/cacheService", () => ({
  cacheDelPattern: vi.fn().mockResolvedValue(undefined),
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
