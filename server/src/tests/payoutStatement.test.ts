import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { Request, Response } from "express";
import User from "../models/User";
import Prompt from "../models/Prompt";
import Purchase from "../models/Purchase";
import { GetCreatorPayoutStatement } from "../controllers/purchaseControllers";

vi.mock("../db/connectDb", () => ({
  default: vi.fn(),
}));

describe("GetCreatorPayoutStatement", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockReq = {
      params: {},
      query: {},
      headers: {},
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      send: vi.fn().mockReturnThis(),
    };

    vi.clearAllMocks();
  });

  it("should return 400 if walletAddress is missing", async () => {
    mockReq.params = {};
    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "walletAddress is required." });
  });

  it("should return 404 if user is not found", async () => {
    mockReq.params = { walletAddress: "nonexistent-wallet" };
    vi.spyOn(User, "findOne").mockReturnValue({
      select: vi.fn().mockResolvedValue(null),
    } as any);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "User not found." });
  });

  it("should return an empty statement array when creator has no prompts", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };

    const mockUserId = new mongoose.Types.ObjectId();
    vi.spyOn(User, "findOne").mockReturnValue({
      select: vi.fn().mockResolvedValue({ _id: mockUserId, walletAddress: creatorWallet }),
    } as any);

    vi.spyOn(Prompt, "find").mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.json).toHaveBeenCalledWith({ statement: [] });
  });

  it("should return empty CSV header when creator has no prompts and format=csv", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };
    mockReq.query = { format: "csv" };

    const mockUserId = new mongoose.Types.ObjectId();
    vi.spyOn(User, "findOne").mockReturnValue({
      select: vi.fn().mockResolvedValue({ _id: mockUserId, walletAddress: creatorWallet }),
    } as any);

    vi.spyOn(Prompt, "find").mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv");
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.send).toHaveBeenCalledWith(
      `"Sale Date","Prompt Title","Prompt ID","Buyer Address","Gross Amount (XLM)","Platform Fee (XLM)","Creator Amount (XLM)","Transaction Hash"\n`
    );
  });

  it("should return statement with separated gross, fee, and net creator amounts for creator sales", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };

    const mockUserId = new mongoose.Types.ObjectId();
    const promptObjId = new mongoose.Types.ObjectId();

    vi.spyOn(User, "findOne").mockReturnValue({
      select: vi.fn().mockResolvedValue({ _id: mockUserId, walletAddress: creatorWallet }),
    } as any);

    const mockPrompts = [
      {
        _id: promptObjId,
        onChainId: "101",
        title: "Advanced SEO Prompt",
        price: 100, // 100 XLM
      },
    ];

    vi.spyOn(Prompt, "find").mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockPrompts),
      }),
    } as any);

    const saleDate = new Date("2026-07-01T10:00:00Z");
    const mockPurchases = [
      {
        _id: new mongoose.Types.ObjectId(),
        promptId: "101",
        buyerWallet: "0xbuyer456",
        versionIndex: 1,
        txHash: "0xtxhash123",
        createdAt: saleDate,
      },
    ];

    vi.spyOn(Purchase, "find").mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockPurchases),
      }),
    } as any);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.json).toHaveBeenCalledWith({
      statement: [
        {
          id: expect.any(String),
          saleDate: saleDate.toISOString(),
          promptTitle: "Advanced SEO Prompt",
          promptId: "101",
          buyerAddress: "0xbuyer456",
          grossAmount: 100,
          platformFee: 5, // 5% of 100 = 5
          creatorAmount: 95, // 100 - 5 = 95
          txHash: "0xtxhash123",
        },
      ],
    });
  });

  it("should output valid CSV formatted payout statement when format=csv", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };
    mockReq.query = { format: "csv" };

    const mockUserId = new mongoose.Types.ObjectId();
    const promptObjId = new mongoose.Types.ObjectId();

    vi.spyOn(User, "findOne").mockReturnValue({
      select: vi.fn().mockResolvedValue({ _id: mockUserId, walletAddress: creatorWallet }),
    } as any);

    const mockPrompts = [
      {
        _id: promptObjId,
        onChainId: "101",
        title: 'Creative "Quotes" Prompt',
        price: 50,
      },
    ];

    vi.spyOn(Prompt, "find").mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockPrompts),
      }),
    } as any);

    const saleDate = new Date("2026-07-15T12:00:00Z");
    const mockPurchases = [
      {
        _id: new mongoose.Types.ObjectId(),
        promptId: "101",
        buyerWallet: "0xbuyer789",
        txHash: "0xhash999",
        createdAt: saleDate,
      },
    ];

    vi.spyOn(Purchase, "find").mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockPurchases),
      }),
    } as any);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv");
    const expectedCsv =
      `"Sale Date","Prompt Title","Prompt ID","Buyer Address","Gross Amount (XLM)","Platform Fee (XLM)","Creator Amount (XLM)","Transaction Hash"\n` +
      `"${saleDate.toISOString()}","Creative ""Quotes"" Prompt","101","0xbuyer789",50,2.5,47.5,"0xhash999"`;
    expect(mockRes.send).toHaveBeenCalledWith(expectedCsv);
  });

  it("should apply date range filters to purchase query", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };
    mockReq.query = {
      startDate: "2026-07-01",
      endDate: "2026-07-10",
    };

    const mockUserId = new mongoose.Types.ObjectId();
    vi.spyOn(User, "findOne").mockReturnValue({
      select: vi.fn().mockResolvedValue({ _id: mockUserId, walletAddress: creatorWallet }),
    } as any);

    vi.spyOn(Prompt, "find").mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: "prompt1", onChainId: "1", title: "P1", price: 10 }]),
      }),
    } as any);

    const purchaseFindSpy = vi.spyOn(Purchase, "find").mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(purchaseFindSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: { $in: ["prompt1", "1"] },
        createdAt: {
          $gte: new Date("2026-07-01"),
          $lte: expect.any(Date),
        },
      })
    );
  });
});
