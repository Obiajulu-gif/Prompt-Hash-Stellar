import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response } from "express";
import {
  cacheGet,
  cacheSet,
  cacheGetJson,
  cacheSetJson,
  cacheDel,
  cacheDelPattern,
  invalidatePromptCaches,
  CACHE_KEYS,
  DEFAULT_TTL_SECONDS,
} from "../services/cacheService";

process.env.REDIS_URL = "redis://127.0.0.1:6379";

// Mock redis client
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisKeys = vi.fn();

vi.mock("redis", () => ({
  createClient: vi.fn(() => ({
    isOpen: true,
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
    keys: mockRedisKeys,
  })),
}));

vi.mock("../db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../models/User", () => ({
  default: {
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../models/Prompt", () => {
  const mockPrompts = [
    {
      _id: "prompt-1",
      title: "Optimized Prompt 1",
      category: "Writing",
      price: 10,
      listingStatus: "published",
      isActive: true,
    },
    {
      _id: "prompt-2",
      title: "Optimized Prompt 2",
      category: "Coding",
      price: 20,
      listingStatus: "published",
      isActive: true,
    },
  ];

  return {
    default: {
      find: vi.fn(() => ({
        populate: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockPrompts),
        lean: vi.fn().mockResolvedValue(mockPrompts),
      })),
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findById: vi.fn(),
    },
  };
});

vi.mock("../models/PriceChange", () => ({
  default: {
    findOneAndUpdate: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../models/Purchase", () => ({
  default: {
    findOneAndUpdate: vi.fn(),
    find: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../models/PromptVersion", () => ({
  default: {
    create: vi.fn().mockResolvedValue({ versionIndex: 2 }),
  },
}));

vi.mock("../models/Notification", () => ({
  default: {
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../services/webhookOutbox", () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/similarityDetection", () => ({
  scanForSimilarity: vi.fn().mockResolvedValue(undefined),
  checkSimilarityForContent: vi.fn().mockResolvedValue({ isSimilar: false }),
}));

vi.mock("../services/emailNotifications", () => ({
  notifyPromptReported: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/discordNotifications", () => ({
  announceNewPrompt: vi.fn().mockResolvedValue(undefined),
}));

describe("Redis Cache Service Layer (#114)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get string value from cache when available", async () => {
    mockRedisGet.mockResolvedValueOnce("test-value");
    const result = await cacheGet("test-key");
    expect(result).toBe("test-value");
    expect(mockRedisGet).toHaveBeenCalledWith("test-key");
  });

  it("should return null on cache get error or miss", async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    const miss = await cacheGet("missing-key");
    expect(miss).toBeNull();

    mockRedisGet.mockRejectedValueOnce(new Error("Redis connection closed"));
    const errResult = await cacheGet("error-key");
    expect(errResult).toBeNull();
  });

  it("should set string value with TTL in Redis", async () => {
    mockRedisSet.mockResolvedValueOnce("OK");
    await cacheSet("key-1", "val-1", 120);
    expect(mockRedisSet).toHaveBeenCalledWith("key-1", "val-1", { EX: 120 });
  });

  it("should serialize and deserialize JSON values correctly", async () => {
    const payload = { id: "123", title: "AI Prompt", count: 42 };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(payload));

    const retrieved = await cacheGetJson<typeof payload>("json-key");
    expect(retrieved).toEqual(payload);

    mockRedisSet.mockResolvedValueOnce("OK");
    await cacheSetJson("json-key", payload, 60);
    expect(mockRedisSet).toHaveBeenCalledWith("json-key", JSON.stringify(payload), { EX: 60 });
  });

  it("should delete specific keys", async () => {
    mockRedisDel.mockResolvedValueOnce(1);
    await cacheDel("key-1", "key-2");
    expect(mockRedisDel).toHaveBeenCalledWith(["key-1", "key-2"]);
  });

  it("should delete keys matching a pattern", async () => {
    mockRedisKeys.mockResolvedValueOnce(["prompts:list:1", "prompts:list:2"]);
    mockRedisDel.mockResolvedValueOnce(2);

    await cacheDelPattern("prompts:list:*");
    expect(mockRedisKeys).toHaveBeenCalledWith("prompts:list:*");
    expect(mockRedisDel).toHaveBeenCalledWith(["prompts:list:1", "prompts:list:2"]);
  });

  it("should thoroughly invalidate all prompt-related caches in invalidatePromptCaches", async () => {
    mockRedisKeys.mockImplementation((pattern: string) => {
      return Promise.resolve([`matched:${pattern}`]);
    });
    mockRedisDel.mockResolvedValue(1);

    await invalidatePromptCaches("prompt-42");

    expect(mockRedisDel).toHaveBeenCalledWith([
      CACHE_KEYS.promptDetail("prompt-42"),
      CACHE_KEYS.promptMetadata("prompt-42"),
    ]);
    expect(mockRedisKeys).toHaveBeenCalledWith("prompts:list:*");
    expect(mockRedisKeys).toHaveBeenCalledWith("prompts:all:*");
    expect(mockRedisKeys).toHaveBeenCalledWith("prompts:featured:*");
    expect(mockRedisKeys).toHaveBeenCalledWith("search:signals:*");
    expect(mockRedisKeys).toHaveBeenCalledWith("search:suggestions:*");
    expect(mockRedisKeys).toHaveBeenCalledWith("entitlement:prompt-42:*");
  });

  it("generates deterministic cache keys", () => {
    expect(CACHE_KEYS.allPrompts("cat=AI")).toBe("prompts:all:cat=AI");
    expect(CACHE_KEYS.promptDetail("123")).toBe("prompts:detail:123");
    expect(CACHE_KEYS.promptMetadata("123")).toBe("prompts:metadata:123");
    expect(CACHE_KEYS.categories()).toBe("prompts:categories");
    expect(CACHE_KEYS.featuredPrompts(6)).toBe("prompts:featured:6");
    expect(CACHE_KEYS.searchSuggestions("react:5")).toBe("search:suggestions:react:5");
    expect(CACHE_KEYS.searchResults("filter-1")).toBe("search:signals:filter-1");
  });
});

describe("Metadata Indexing Service & PromptUpdated Invalidation (#114)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should cache and retrieve prompt metadata in indexing service", async () => {
    const { getCachedPromptMetadata, cachePromptMetadata } = await import(
      "../services/indexer"
    );

    const metadata = { promptId: "prompt-100", title: "Test", price: 15 };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(metadata));

    const cached = await getCachedPromptMetadata("prompt-100");
    expect(cached).toEqual(metadata);

    mockRedisSet.mockResolvedValueOnce("OK");
    await cachePromptMetadata("prompt-100", metadata);
    expect(mockRedisSet).toHaveBeenCalledWith(
      CACHE_KEYS.promptMetadata("prompt-100"),
      JSON.stringify(metadata),
      { EX: expect.any(Number) },
    );
  });

  it("should handle PromptUpdated event by updating prompt version and invalidating caches", async () => {
    const { routeDecodedEvent } = await import("../services/indexer");
    const Prompt = (await import("../models/Prompt")).default;

    mockRedisKeys.mockResolvedValue(["prompts:list:1"]);
    mockRedisDel.mockResolvedValue(1);

    await routeDecodedEvent(
      "PromptUpdated",
      { prompt_id: 101, version: 3 },
      "evt-101",
    );

    expect(Prompt.findOneAndUpdate).toHaveBeenCalledWith(
      { onChainId: "101" },
      { $set: { currentVersionIndex: 3 } },
    );
    expect(mockRedisDel).toHaveBeenCalledWith([
      CACHE_KEYS.promptDetail("101"),
      CACHE_KEYS.promptMetadata("101"),
    ]);
  });

  it("should handle ListingRevised event by updating revision and invalidating caches", async () => {
    const { routeDecodedEvent } = await import("../services/indexer");
    const Prompt = (await import("../models/Prompt")).default;

    mockRedisKeys.mockResolvedValue([]);
    mockRedisDel.mockResolvedValue(1);

    await routeDecodedEvent(
      "ListingRevised",
      { prompt_id: 202, new_revision: 5 },
      "evt-202",
    );

    expect(Prompt.findOneAndUpdate).toHaveBeenCalledWith(
      { onChainId: "202" },
      { $set: { currentRevision: 5 } },
    );
    expect(mockRedisDel).toHaveBeenCalledWith([
      CACHE_KEYS.promptDetail("202"),
      CACHE_KEYS.promptMetadata("202"),
    ]);
  });

  it("should invalidate caches on PostPromptUpdate API endpoint", async () => {
    const { PostPromptUpdate } = await import("../controllers/versioningControllers");
    const User = (await import("../models/User")).default;
    const Prompt = (await import("../models/Prompt")).default;

    const mockReq = {
      body: {
        promptId: "prompt-999",
        walletAddress: "GCREATOR_TEST",
        content: "Updated Prompt Content",
        changeNote: "Optimized prompt instructions",
      },
    } as Partial<Request>;

    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as Partial<Response>;

    (User.findOne as any).mockResolvedValueOnce({ _id: "user-creator-1" });
    (Prompt.findOne as any).mockResolvedValueOnce({
      _id: "prompt-999",
      onChainId: "999",
      owner: "user-creator-1",
      currentVersionIndex: 1,
      title: "My AI Prompt",
    });

    mockRedisKeys.mockResolvedValue([]);
    mockRedisDel.mockResolvedValue(1);

    await PostPromptUpdate(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRedisDel).toHaveBeenCalledWith([
      CACHE_KEYS.promptDetail("prompt-999"),
      CACHE_KEYS.promptMetadata("prompt-999"),
    ]);
  });
});

describe("Optimize Slow-Running 'All Prompts' Queries (#114)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return cached response on cache hit without re-querying MongoDB", async () => {
    const { GetPrompts } = await import("../controllers/controllers");
    const Prompt = (await import("../models/Prompt")).default;

    const cachedData = {
      data: [{ _id: "p1", title: "Cached Prompt" }],
      metadata: { hasNextPage: false, nextCursor: null },
    };

    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const mockReq = {
      query: { category: "Writing", limit: "20" },
      url: "/api/prompts?category=Writing&limit=20",
      headers: { host: "localhost:5000" },
    } as Partial<Request>;

    const mockRes = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as Partial<Response>;

    await GetPrompts(mockReq as Request, mockRes as Response);

    expect(mockRedisGet).toHaveBeenCalled();
    expect(mockRes.json).toHaveBeenCalledWith(cachedData);
    // MongoDB should NOT be queried on cache hit
    expect(Prompt.find).not.toHaveBeenCalled();
  });

  it("should query MongoDB with lean execution and store result in cache on cache miss", async () => {
    const { GetPrompts } = await import("../controllers/controllers");
    const Prompt = (await import("../models/Prompt")).default;

    mockRedisGet.mockResolvedValueOnce(null); // Cache miss
    mockRedisSet.mockResolvedValueOnce("OK");

    const mockReq = {
      query: { category: "Coding", limit: "10" },
      url: "/api/prompts?category=Coding&limit=10",
      headers: { host: "localhost:5000" },
    } as Partial<Request>;

    const mockRes = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as Partial<Response>;

    await GetPrompts(mockReq as Request, mockRes as Response);

    expect(Prompt.find).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Coding",
        listingStatus: "published",
        isActive: true,
      }),
    );
    expect(mockRedisSet).toHaveBeenCalledWith(
      expect.stringContaining("prompts:all:"),
      expect.any(String),
      { EX: DEFAULT_TTL_SECONDS },
    );
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.any(Array),
        metadata: expect.any(Object),
      }),
    );
  });
});
