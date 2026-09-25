import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { Request, Response } from "express";
import User from "../models/User";
import Prompt from "../models/Prompt";
import Purchase from "../models/Purchase";
import { GetCreatorPayoutStatement } from "../controllers/purchaseControllers";
import {
  reconcilePayoutEvents,
  buildStatementLine,
  settlementStatusFor,
  type PayoutEventSource,
} from "../services/payoutReconciliation";

vi.mock("../db/connectDb", () => ({
  default: vi.fn(),
}));

function mockUserFind(user: unknown) {
  vi.spyOn(User, "findOne").mockReturnValue({
    select: vi.fn().mockResolvedValue(user),
  } as any);
}

function mockPromptFind(prompts: unknown[]) {
  vi.spyOn(Prompt, "find").mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(prompts),
    }),
  } as any);
}

function mockPurchaseFind(purchases: unknown[]) {
  return vi.spyOn(Purchase, "find").mockReturnValue({
    sort: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(purchases),
    }),
  } as any);
}

describe("payoutReconciliation service", () => {
  it("builds a sale line with separated gross, fee, and net amounts", () => {
    const line = buildStatementLine(
      {
        _id: "purchase-1",
        promptId: "101",
        buyerWallet: "0xbuyer",
        txHash: "0xhash",
        createdAt: new Date("2026-07-01T10:00:00Z"),
      },
      { _id: "p1", onChainId: "101", title: "T", price: 100 },
    );

    expect(line).toMatchObject({
      kind: "sale",
      grossAmount: 100,
      platformFee: 5,
      creatorAmount: 95,
      settlementStatus: "settled",
    });
  });

  it("balances gross, fees, refunds, and net payout across a refund after payout", () => {
    const sale: PayoutEventSource = {
      _id: "sale-1",
      promptId: "101",
      buyerWallet: "0xbuyer",
      txHash: "0xsale",
      createdAt: new Date("2026-07-01"),
    };
    const refund: PayoutEventSource = {
      _id: "refund-1",
      promptId: "102",
      buyerWallet: "0xbuyer2",
      disputeResolution: "refunded",
      status: "resolved",
      txHash: "0xrefund",
      createdAt: new Date("2026-07-10"),
    };

    const promptByKey = new Map([
      ["101", { onChainId: "101", title: "A", price: 100 }],
      ["102", { onChainId: "102", title: "B", price: 50 }],
    ]);

    const result = reconcilePayoutEvents([sale, refund], promptByKey as any);

    expect(result.balanced).toBe(true);
    expect(result.summary.grossAmount).toBe(100);
    expect(result.summary.platformFee).toBeCloseTo(2.5); // 5 - 2.5 refund fee credit
    expect(result.summary.refunds).toBe(50);
    expect(result.summary.netSettlement).toBeCloseTo(47.5); // 95 - 47.5
    expect(result.summary.grossAmount - result.summary.platformFee - result.summary.refunds).toBeCloseTo(
      result.summary.netSettlement,
    );
  });

  it("reconciles a partial period using only the events provided", () => {
    const january: PayoutEventSource = {
      _id: "jan",
      promptId: "101",
      buyerWallet: "0xa",
      txHash: "0x1",
      createdAt: new Date("2026-01-15"),
    };
    const february: PayoutEventSource = {
      _id: "feb",
      promptId: "101",
      buyerWallet: "0xb",
      txHash: "0x2",
      createdAt: new Date("2026-02-15"),
    };

    const promptByKey = new Map([["101", { onChainId: "101", price: 100 }]]);

    const partial = reconcilePayoutEvents([january], promptByKey as any);
    const full = reconcilePayoutEvents([january, february], promptByKey as any);

    expect(partial.summary.grossAmount).toBe(100);
    expect(full.summary.grossAmount).toBe(200);
    expect(partial.balanced).toBe(true);
  });

  it("marks pending and failed settlements clearly", () => {
    expect(
      settlementStatusFor({
        _id: "x",
        promptId: "1",
        buyerWallet: "0xa",
        txHash: "0xabc",
      }),
    ).toBe("settled");

    expect(
      settlementStatusFor({
        _id: "x",
        promptId: "1",
        buyerWallet: "0xa",
      }),
    ).toBe("pending");

    expect(
      settlementStatusFor({
        _id: "x",
        promptId: "1",
        buyerWallet: "0xa",
        status: "resolved",
        disputeResolution: "refunded",
      }),
    ).toBe("failed");
  });

  it("represents a failed payout in the statement status", () => {
    const purchases: PayoutEventSource[] = [
      { _id: "ok", promptId: "101", buyerWallet: "0xa", txHash: "0xsale" },
      {
        _id: "failed-refund",
        promptId: "102",
        buyerWallet: "0xb",
        status: "resolved",
        disputeResolution: "refunded",
      },
    ];
    const promptByKey = new Map([
      ["101", { price: 100 }],
      ["102", { price: 50 }],
    ]);
    const result = reconcilePayoutEvents(purchases, promptByKey as any);

    const refundLine = result.statement.find((l) => l.id === "failed-refund");
    expect(refundLine?.settlementStatus).toBe("failed");
    expect(result.status).toBe("failed");
  });

  it("represents a pending settlement in the statement status", () => {
    const purchases: PayoutEventSource[] = [
      { _id: "ok", promptId: "101", buyerWallet: "0xa", txHash: "0xsale" },
      { _id: "pending", promptId: "101", buyerWallet: "0xb" },
    ];
    const promptByKey = new Map([["101", { price: 100 }]]);
    const result = reconcilePayoutEvents(purchases, promptByKey as any);

    expect(result.statement.find((l) => l.id === "pending")?.settlementStatus).toBe("pending");
    expect(result.status).toBe("pending");
  });
});

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
    mockUserFind(null);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "User not found." });
  });

  it("should return an empty balanced statement array when creator has no prompts", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };

    const mockUserId = new mongoose.Types.ObjectId();
    mockUserFind({ _id: mockUserId, walletAddress: creatorWallet });
    mockPromptFind([]);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.json).toHaveBeenCalledWith({
      statement: [],
      summary: {
        grossAmount: 0,
        platformFee: 0,
        refunds: 0,
        netSettlement: 0,
        settlementStatus: "settled",
      },
      status: "settled",
      balanced: true,
    });
  });

  it("should return empty CSV header when creator has no prompts and format=csv", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };
    mockReq.query = { format: "csv" };

    const mockUserId = new mongoose.Types.ObjectId();
    mockUserFind({ _id: mockUserId, walletAddress: creatorWallet });
    mockPromptFind([]);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv");
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.send).toHaveBeenCalledWith(
      `"Sale Date","Type","Prompt Title","Prompt ID","Buyer Address","Gross Amount (XLM)","Platform Fee (XLM)","Creator Amount (XLM)","Settlement Status","Transaction Hash"\n`
    );
  });

  it("should return a reconciled statement with summary for creator sales", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };

    const mockUserId = new mongoose.Types.ObjectId();
    const promptObjId = new mongoose.Types.ObjectId();
    mockUserFind({ _id: mockUserId, walletAddress: creatorWallet });

    const mockPrompts = [
      {
        _id: promptObjId,
        onChainId: "101",
        title: "Advanced SEO Prompt",
        price: 100,
      },
    ];
    mockPromptFind(mockPrompts);

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
    mockPurchaseFind(mockPurchases);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.json).toHaveBeenCalledWith({
      statement: [
        {
          id: expect.any(String),
          kind: "sale",
          saleDate: saleDate.toISOString(),
          promptTitle: "Advanced SEO Prompt",
          promptId: "101",
          buyerAddress: "0xbuyer456",
          grossAmount: 100,
          platformFee: 5,
          creatorAmount: 95,
          txHash: "0xtxhash123",
          settlementStatus: "settled",
        },
      ],
      summary: {
        grossAmount: 100,
        platformFee: 5,
        refunds: 0,
        netSettlement: 95,
        settlementStatus: "settled",
      },
      status: "settled",
      balanced: true,
    });
  });

  it("should output valid CSV formatted payout statement when format=csv", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };
    mockReq.query = { format: "csv" };

    const mockUserId = new mongoose.Types.ObjectId();
    const promptObjId = new mongoose.Types.ObjectId();
    mockUserFind({ _id: mockUserId, walletAddress: creatorWallet });

    mockPromptFind([
      {
        _id: promptObjId,
        onChainId: "101",
        title: 'Creative "Quotes" Prompt',
        price: 50,
      },
    ]);

    const saleDate = new Date("2026-07-15T12:00:00Z");
    mockPurchaseFind([
      {
        _id: new mongoose.Types.ObjectId(),
        promptId: "101",
        buyerWallet: "0xbuyer789",
        txHash: "0xhash999",
        createdAt: saleDate,
      },
    ]);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv");
    const expectedCsv =
      `"Sale Date","Type","Prompt Title","Prompt ID","Buyer Address","Gross Amount (XLM)","Platform Fee (XLM)","Creator Amount (XLM)","Settlement Status","Transaction Hash"\n` +
      `"${saleDate.toISOString()}",sale,"Creative ""Quotes"" Prompt","101","0xbuyer789",50,2.5,47.5,settled,"0xhash999"`;
    expect(mockRes.send).toHaveBeenCalledWith(expectedCsv);
  });

  it("should include refund lines and balanced summary when sales were refunded", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };

    const mockUserId = new mongoose.Types.ObjectId();
    mockUserFind({ _id: mockUserId, walletAddress: creatorWallet });

    mockPromptFind([
      { _id: new mongoose.Types.ObjectId(), onChainId: "101", title: "P1", price: 100 },
      { _id: new mongoose.Types.ObjectId(), onChainId: "102", title: "P2", price: 50 },
    ]);

    const saleDate = new Date("2026-07-01T10:00:00Z");
    const refundDate = new Date("2026-07-20T10:00:00Z");
    mockPurchaseFind([
      {
        _id: new mongoose.Types.ObjectId(),
        promptId: "101",
        buyerWallet: "0xbuyer456",
        txHash: "0xsale",
        createdAt: saleDate,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        promptId: "102",
        buyerWallet: "0xbuyer789",
        status: "resolved",
        disputeResolution: "refunded",
        txHash: "0xrefund",
        createdAt: refundDate,
      },
    ]);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statement: expect.arrayContaining([
          expect.objectContaining({ kind: "sale", grossAmount: 100 }),
          expect.objectContaining({
            kind: "refund",
            grossAmount: -50,
            platformFee: -2.5,
            creatorAmount: -47.5,
            settlementStatus: "settled",
          }),
        ]),
        summary: expect.objectContaining({
          grossAmount: 100,
          refunds: 50,
          platformFee: 2.5,
          netSettlement: 47.5,
        }),
        status: "settled",
        balanced: true,
      }),
    );
  });

  it("should surface failed and pending settlements clearly", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };

    const mockUserId = new mongoose.Types.ObjectId();
    mockUserFind({ _id: mockUserId, walletAddress: creatorWallet });

    mockPromptFind([
      { _id: new mongoose.Types.ObjectId(), onChainId: "101", title: "P1", price: 100 },
      { _id: new mongoose.Types.ObjectId(), onChainId: "102", title: "P2", price: 100 },
      { _id: new mongoose.Types.ObjectId(), onChainId: "103", title: "P3", price: 100 },
    ]);

    mockPurchaseFind([
      {
        _id: new mongoose.Types.ObjectId(),
        promptId: "101",
        buyerWallet: "0xbuyer456",
        txHash: "0xsale",
        createdAt: new Date("2026-07-01"),
      },
      {
        _id: new mongoose.Types.ObjectId(),
        promptId: "102",
        buyerWallet: "0xbuyer789",
        status: "resolved",
        disputeResolution: "refunded",
        createdAt: new Date("2026-07-02"),
      },
      {
        _id: new mongoose.Types.ObjectId(),
        promptId: "103",
        buyerWallet: "0xbuyer000",
        createdAt: new Date("2026-07-03"),
      },
    ]);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statement: expect.arrayContaining([
          expect.objectContaining({ promptId: "101", settlementStatus: "settled" }),
          expect.objectContaining({ promptId: "102", settlementStatus: "failed" }),
          expect.objectContaining({ promptId: "103", settlementStatus: "pending" }),
        ]),
        status: "failed",
      }),
    );
  });

  it("should apply date range filters to purchase query", async () => {
    const creatorWallet = "0xcreator123";
    mockReq.params = { walletAddress: creatorWallet };
    mockReq.query = {
      startDate: "2026-07-01",
      endDate: "2026-07-10",
    };

    const mockUserId = new mongoose.Types.ObjectId();
    mockUserFind({ _id: mockUserId, walletAddress: creatorWallet });

    mockPromptFind([{ _id: "prompt1", onChainId: "1", title: "P1", price: 10 }]);

    const purchaseFindSpy = mockPurchaseFind([]);

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

  it("should handle Stellar standard Ed25519 addresses and Muxed account lookups", async () => {
    const standardStellarAddress = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2ZVOUSAC2WSRWZ7CXBD";
    mockReq.params = { walletAddress: standardStellarAddress };

    const mockUserId = new mongoose.Types.ObjectId();
    mockUserFind({ _id: mockUserId, walletAddress: standardStellarAddress.toLowerCase() });
    mockPromptFind([{ _id: "prompt1", onChainId: "1", title: "P1", price: 10 }]);
    mockPurchaseFind([]);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statement: [],
        status: "settled",
        balanced: true,
      }),
    );
  });

  it("should mark settlement status as failed when transactions fail destination verification", async () => {
    const creatorWallet = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2ZVOUSAC2WSRWZ7CXBD";
    mockReq.params = { walletAddress: creatorWallet };

    const mockUserId = new mongoose.Types.ObjectId();
    mockUserFind({ _id: mockUserId, walletAddress: creatorWallet.toLowerCase() });

    mockPromptFind([{ _id: "prompt1", onChainId: "1", title: "P1", price: 50 }]);
    mockPurchaseFind([
      {
        _id: new mongoose.Types.ObjectId(),
        promptId: "1",
        buyerWallet: "0xbuyer",
        status: "resolved",
        disputeResolution: "destination_unfunded_failed",
      },
    ]);

    await GetCreatorPayoutStatement(mockReq as Request, mockRes as Response);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        statement: expect.arrayContaining([
          expect.objectContaining({
            settlementStatus: "failed",
          }),
        ]),
      }),
    );
  });
});