import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PromptHashClient, type PromptHashConfig } from "../promptHashClient";

const mockConfig: PromptHashConfig = {
  rpcUrl: "http://localhost:8000",
  networkPassphrase: "Test SDF Network",
  promptHashContractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  nativeAssetContractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
};

describe("PromptHashClient.findPromptByContentHash (#333)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset REACT_APP_API_URL to default
    delete (process.env as any).REACT_APP_API_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when no duplicates are found", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          found: false,
          matches: [],
          count: 0,
        }),
        { status: 200 },
      ),
    );

    const result = await PromptHashClient.findPromptByContentHash(
      mockConfig,
      "abcdef0123456789abcdef0123456789",
    );

    expect(result).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/prompts/hash/abcdef0123456789abcdef0123456789"),
    );
  });

  it("returns matching prompts with correct structure", async () => {
    const mockMatches = [
      {
        id: "12345",
        title: "Original Prompt",
        creator: "GCAAA123...",
        salesCount: 10,
        isActive: true,
      },
    ];

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          found: true,
          matches: mockMatches,
          count: 1,
        }),
        { status: 200 },
      ),
    );

    const result = await PromptHashClient.findPromptByContentHash(
      mockConfig,
      "abcdef0123456789abcdef0123456789",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: BigInt(12345),
      title: "Original Prompt",
      creator: "GCAAA123...",
      salesCount: 10,
      active: true,
      contentHash: "abcdef0123456789abcdef0123456789",
    });
  });

  it("returns multiple matches when duplicates exist", async () => {
    const mockMatches = [
      {
        id: "12345",
        title: "First Duplicate",
        creator: "GCAAA123...",
        salesCount: 5,
        isActive: true,
      },
      {
        id: "67890",
        title: "Second Duplicate",
        creator: "GCBBB456...",
        salesCount: 3,
        isActive: true,
      },
    ];

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          found: true,
          matches: mockMatches,
          count: 2,
        }),
        { status: 200 },
      ),
    );

    const result = await PromptHashClient.findPromptByContentHash(
      mockConfig,
      "fedcba9876543210fedcba9876543210",
    );

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(BigInt(12345));
    expect(result[1].id).toBe(BigInt(67890));
  });

  it("handles API errors gracefully and returns empty array", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500 },
      ),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await PromptHashClient.findPromptByContentHash(
      mockConfig,
      "abcdef0123456789abcdef0123456789",
    );

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("handles network errors gracefully", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await PromptHashClient.findPromptByContentHash(
      mockConfig,
      "abcdef0123456789abcdef0123456789",
    );

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("uses custom API URL when REACT_APP_API_URL is set", async () => {
    (process.env as any).REACT_APP_API_URL = "https://custom-api.example.com";

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          found: false,
          matches: [],
          count: 0,
        }),
        { status: 200 },
      ),
    );

    await PromptHashClient.findPromptByContentHash(
      mockConfig,
      "abcdef0123456789abcdef0123456789",
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://custom-api.example.com"),
    );
  });

  it("transforms API response to PromptRecord format correctly", async () => {
    const mockMatch = {
      id: "999",
      title: "Test Prompt",
      creator: "GCCREATOR...",
      salesCount: 42,
      isActive: true,
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          found: true,
          matches: [mockMatch],
          count: 1,
        }),
        { status: 200 },
      ),
    );

    const result = await PromptHashClient.findPromptByContentHash(
      mockConfig,
      "0123456789abcdef0123456789abcdef",
    );

    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("title");
    expect(result[0]).toHaveProperty("creator");
    expect(result[0]).toHaveProperty("priceStroops");
    expect(result[0]).toHaveProperty("active");
    expect(result[0]).toHaveProperty("contentHash");
    expect(result[0].priceStroops).toBe(BigInt(0)); // Not included in response
  });

  it("handles prompts with missing optional fields", async () => {
    const mockMatch = {
      id: "111",
      title: "Minimal Prompt",
      creator: "GCUSER123...",
      // salesCount and isActive may be missing
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          found: true,
          matches: [mockMatch as any],
          count: 1,
        }),
        { status: 200 },
      ),
    );

    const result = await PromptHashClient.findPromptByContentHash(
      mockConfig,
      "11111111111111111111111111111111",
    );

    expect(result[0].salesCount).toBe(0); // Default fallback
    expect(result[0].active).toBeUndefined(); // Undefined if missing
  });

  it("can be used via the exported wrapper function", async () => {
    const { findPromptByContentHash } = await import("../promptHashClient");

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          found: false,
          matches: [],
          count: 0,
        }),
        { status: 200 },
      ),
    );

    const result = await findPromptByContentHash(
      mockConfig,
      "ffffffffffffffffffffffffffffffff",
    );

    expect(Array.isArray(result)).toBe(true);
  });
});
