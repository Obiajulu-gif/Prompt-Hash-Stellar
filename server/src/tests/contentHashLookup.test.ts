import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { GetPromptsByContentHash } from "../controllers/controllers";
import Prompt from "../models/Prompt";
import User from "../models/User";

vi.mock("../db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../models/Prompt");
vi.mock("../models/User");

function makeReq(params: Record<string, string> = {}): Partial<Request> {
  return {
    params,
  };
}

function makeRes(): Partial<Response> {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Partial<Response>;
}

describe("GetPromptsByContentHash controller (#333)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 if contentHash param is missing", async () => {
    const req = makeReq({});
    const res = makeRes();

    await GetPromptsByContentHash(req as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "contentHash is required." }),
    );
  });

  it("returns 400 if contentHash format is invalid (non-hex)", async () => {
    const req = makeReq({ contentHash: "not-a-hex-string!" });
    const res = makeRes();

    await GetPromptsByContentHash(req as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Invalid content hash format." }),
    );
  });

  it("returns empty matches for a hash with no duplicates", async () => {
    const validHash = "abcdef0123456789abcdef0123456789";
    const req = makeReq({ contentHash: validHash });
    const res = makeRes();

    vi.mocked(Prompt.find).mockResolvedValueOnce([]);

    await GetPromptsByContentHash(req as Request, res as Response);

    expect(Prompt.find).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: validHash,
        listingStatus: "published",
        isActive: true,
      }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        found: false,
        matches: [],
        count: 0,
      }),
    );
  });

  it("returns matching prompts with creator wallet addresses", async () => {
    const validHash = "abcdef0123456789abcdef0123456789";
    const req = makeReq({ contentHash: validHash });
    const res = makeRes();

    const mockPrompt = {
      _id: "prompt-1",
      onChainId: "12345",
      title: "Matching Prompt",
      owner: "owner-id-1",
      salesCount: 5,
      isActive: true,
    };

    const mockUser = {
      _id: "owner-id-1",
      walletAddress: "GCXYZ...",
    };

    vi.mocked(Prompt.find).mockReturnValue({
      select: vi.fn().mockResolvedValue([mockPrompt]),
    } as any);

    vi.mocked(User.findById).mockResolvedValue(mockUser as any);

    await GetPromptsByContentHash(req as Request, res as Response);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        found: true,
        count: 1,
        matches: [
          expect.objectContaining({
            id: "12345",
            title: "Matching Prompt",
            creator: "GCXYZ...",
            salesCount: 5,
            isActive: true,
          }),
        ],
      }),
    );
  });

  it("returns multiple matches when multiple prompts share the same content hash", async () => {
    const validHash = "abcdef0123456789abcdef0123456789";
    const req = makeReq({ contentHash: validHash });
    const res = makeRes();

    const mockPrompts = [
      {
        _id: "prompt-1",
        onChainId: "12345",
        title: "First Duplicate",
        owner: "owner-id-1",
        salesCount: 5,
        isActive: true,
      },
      {
        _id: "prompt-2",
        onChainId: "67890",
        title: "Second Duplicate",
        owner: "owner-id-2",
        salesCount: 3,
        isActive: true,
      },
    ];

    const mockUsers = [
      { _id: "owner-id-1", walletAddress: "GCAAA..." },
      { _id: "owner-id-2", walletAddress: "GCBBB..." },
    ];

    vi.mocked(Prompt.find).mockReturnValue({
      select: vi.fn().mockResolvedValue(mockPrompts),
    } as any);

    vi.mocked(User.findById)
      .mockResolvedValueOnce(mockUsers[0] as any)
      .mockResolvedValueOnce(mockUsers[1] as any);

    await GetPromptsByContentHash(req as Request, res as Response);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        found: true,
        count: 2,
        matches: expect.arrayContaining([
          expect.objectContaining({
            id: "12345",
            title: "First Duplicate",
            creator: "GCAAA...",
          }),
          expect.objectContaining({
            id: "67890",
            title: "Second Duplicate",
            creator: "GCBBB...",
          }),
        ]),
      }),
    );
  });

  it("returns 'unknown' for creator if user lookup fails", async () => {
    const validHash = "abcdef0123456789abcdef0123456789";
    const req = makeReq({ contentHash: validHash });
    const res = makeRes();

    const mockPrompt = {
      _id: "prompt-1",
      onChainId: "12345",
      title: "Orphaned Prompt",
      owner: "missing-user-id",
      salesCount: 2,
      isActive: true,
    };

    vi.mocked(Prompt.find).mockReturnValue({
      select: vi.fn().mockResolvedValue([mockPrompt]),
    } as any);

    vi.mocked(User.findById).mockResolvedValue(null);

    await GetPromptsByContentHash(req as Request, res as Response);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        found: true,
        count: 1,
        matches: [
          expect.objectContaining({
            creator: "unknown",
          }),
        ],
      }),
    );
  });

  it("accepts valid hex hashes of various lengths (32-128 chars)", async () => {
    const res = makeRes();

    // Test 32-char hash (SHA-256 output in hex)
    const req32 = makeReq({ contentHash: "a".repeat(32) });
    vi.mocked(Prompt.find).mockResolvedValueOnce([]);
    await GetPromptsByContentHash(req32 as Request, res as Response);
    expect(res.status).not.toHaveBeenCalledWith(400);

    // Test 64-char hash (SHA-512 output in hex)
    const req64 = makeReq({ contentHash: "b".repeat(64) });
    vi.mocked(Prompt.find).mockResolvedValueOnce([]);
    await GetPromptsByContentHash(req64 as Request, res as Response);
    expect(res.status).not.toHaveBeenCalledWith(400);

    // Test 128-char hash (Keccak-256 or other large hash in hex)
    const req128 = makeReq({ contentHash: "c".repeat(128) });
    vi.mocked(Prompt.find).mockResolvedValueOnce([]);
    await GetPromptsByContentHash(req128 as Request, res as Response);
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  it("rejects hashes that are too short or too long", async () => {
    const res = makeRes();

    // Too short (31 chars)
    const reqShort = makeReq({ contentHash: "a".repeat(31) });
    await GetPromptsByContentHash(reqShort as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);

    vi.clearAllMocks();

    // Too long (129 chars)
    const reqLong = makeReq({ contentHash: "b".repeat(129) });
    await GetPromptsByContentHash(reqLong as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("handles database errors gracefully", async () => {
    const validHash = "abcdef0123456789abcdef0123456789";
    const req = makeReq({ contentHash: validHash });
    const res = makeRes();

    vi.mocked(Prompt.find).mockRejectedValueOnce(
      new Error("Database connection failed"),
    );

    await GetPromptsByContentHash(req as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(String),
      }),
    );
  });
});
