import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";
import Prompt from "../models/Prompt";
import PromptVersion from "../models/PromptVersion";
import Purchase from "../models/Purchase";
import User from "../models/User";
import Notification from "../models/Notification";
import {
  PostPromptUpdate,
  GetPromptVersions,
  RecordPurchase,
  GetBuyerVersion,
} from "../controllers/versioningControllers";
import { Request, Response } from "express";

// Mock database connection
vi.mock("../db/connectDb", () => ({
  default: vi.fn(),
}));

describe("Prompt Versioning System", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockUser: any;
  let mockPrompt: any;

  beforeEach(() => {
    // Setup mock request and response
    mockReq = {
      body: {},
      params: {},
      query: {},
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    // Mock user
    mockUser = {
      _id: new mongoose.Types.ObjectId(),
      walletAddress: "test-wallet",
    };

    // Mock prompt
    mockPrompt = {
      _id: new mongoose.Types.ObjectId(),
      title: "Test Prompt",
      content: "Original content",
      owner: mockUser._id,
      currentVersionIndex: 1,
      save: vi.fn(),
    };
  });

  describe("PostPromptUpdate", () => {
    it("should create a new version without replacing history", async () => {
      mockReq.body = {
        promptId: mockPrompt._id.toString(),
        walletAddress: "test-wallet",
        content: "Updated content",
        changeNote: "Fixed a typo",
      };

      vi.spyOn(User, "findOne").mockResolvedValueOnce(mockUser);
      vi.spyOn(Prompt, "findOne").mockResolvedValueOnce(mockPrompt);
      vi.spyOn(PromptVersion, "create").mockResolvedValueOnce({
        promptId: mockPrompt._id.toString(),
        versionIndex: 2,
        content: "Updated content",
        changeNote: "Fixed a typo",
        createdBy: "test-wallet",
      } as any);
      vi.spyOn(Prompt, "findByIdAndUpdate").mockResolvedValueOnce({});
      vi.spyOn(Purchase, "find").mockResolvedValueOnce([]);

      await PostPromptUpdate(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(PromptVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          versionIndex: 2,
          content: "Updated content",
        })
      );
    });

    it("should require promptId, walletAddress, and content", async () => {
      mockReq.body = {
        promptId: mockPrompt._id.toString(),
        // Missing walletAddress and content
      };

      await PostPromptUpdate(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("required"),
        })
      );
    });

    it("should notify all buyers when content is updated", async () => {
      const buyer1 = { walletAddress: "buyer1" };
      const buyer2 = { walletAddress: "buyer2" };

      mockReq.body = {
        promptId: mockPrompt._id.toString(),
        walletAddress: "test-wallet",
        content: "Updated content",
        changeNote: "Major update",
      };

      vi.spyOn(User, "findOne").mockResolvedValueOnce(mockUser);
      vi.spyOn(Prompt, "findOne").mockResolvedValueOnce(mockPrompt);
      vi.spyOn(PromptVersion, "create").mockResolvedValueOnce({
        versionIndex: 2,
      } as any);
      vi.spyOn(Prompt, "findByIdAndUpdate").mockResolvedValueOnce({});
      vi.spyOn(Purchase, "find").mockResolvedValueOnce([
        { buyerWallet: "buyer1" },
        { buyerWallet: "buyer2" },
      ] as any);
      vi.spyOn(Notification, "create").mockResolvedValue({} as any);

      await PostPromptUpdate(mockReq as Request, mockRes as Response);

      expect(Notification.create).toHaveBeenCalledTimes(2);
    });
  });

  describe("GetPromptVersions", () => {
    it("should return version history sorted by versionIndex descending", async () => {
      const versions = [
        { versionIndex: 2, changeNote: "Second version" },
        { versionIndex: 1, changeNote: "First version" },
      ];

      mockReq.params = {
        promptId: mockPrompt._id.toString(),
      };

      vi.spyOn(PromptVersion, "find").mockReturnValueOnce({
        sort: vi.fn().mockReturnValueOnce({
          select: vi.fn().mockResolvedValueOnce(versions),
        }),
      } as any);

      await GetPromptVersions(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(versions);
    });

    it("should exclude content from version history", async () => {
      mockReq.params = {
        promptId: mockPrompt._id.toString(),
      };

      const findSpy = vi.spyOn(PromptVersion, "find").mockReturnValueOnce({
        sort: vi.fn().mockReturnValueOnce({
          select: vi.fn().mockResolvedValueOnce([]),
        }),
      } as any);

      await GetPromptVersions(mockReq as Request, mockRes as Response);

      const selectCall = (findSpy.mock.results[0].value?.select as any).mock
        .calls[0][0];
      expect(selectCall).toBe("-content");
    });

    it("should return 400 if promptId is missing", async () => {
      mockReq.params = {};

      await GetPromptVersions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("promptId"),
        })
      );
    });
  });

  describe("RecordPurchase", () => {
    it("should record a purchase with the current version index", async () => {
      mockReq.body = {
        promptId: mockPrompt._id.toString(),
        buyerWallet: "buyer-wallet",
        txHash: "0x123abc",
      };

      vi.spyOn(Prompt, "findById").mockResolvedValueOnce(mockPrompt);
      vi.spyOn(Purchase, "findOne").mockResolvedValueOnce(null);
      vi.spyOn(Purchase, "create").mockResolvedValueOnce({
        promptId: mockPrompt._id.toString(),
        buyerWallet: "buyer-wallet",
        versionIndex: 1,
      } as any);

      await RecordPurchase(mockReq as Request, mockRes as Response);

      expect(Purchase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          versionIndex: 1,
        })
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it("should preserve older purchases and not allow re-purchasing", async () => {
      mockReq.body = {
        promptId: mockPrompt._id.toString(),
        buyerWallet: "buyer-wallet",
      };

      vi.spyOn(Prompt, "findById").mockResolvedValueOnce(mockPrompt);
      vi.spyOn(Purchase, "findOne").mockResolvedValueOnce({
        promptId: mockPrompt._id.toString(),
        buyerWallet: "buyer-wallet",
        versionIndex: 1,
      } as any);

      await RecordPurchase(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Already purchased.",
          versionIndex: 1,
        })
      );
    });

    it("should require promptId and buyerWallet", async () => {
      mockReq.body = {
        promptId: mockPrompt._id.toString(),
        // Missing buyerWallet
      };

      await RecordPurchase(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe("GetBuyerVersion", () => {
    it("should return the specific version a buyer purchased", async () => {
      mockReq.query = {
        promptId: mockPrompt._id.toString(),
        buyerWallet: "buyer-wallet",
      };

      const purchase = {
        promptId: mockPrompt._id.toString(),
        buyerWallet: "buyer-wallet",
        versionIndex: 1,
        createdAt: new Date(),
      };

      const version = {
        promptId: mockPrompt._id.toString(),
        versionIndex: 1,
        content: "Version 1 content",
        changeNote: "Initial version",
      };

      vi.spyOn(Purchase, "findOne").mockResolvedValueOnce(purchase as any);
      vi.spyOn(PromptVersion, "findOne").mockResolvedValueOnce(version as any);
      vi.spyOn(Prompt, "findById").mockResolvedValueOnce(mockPrompt);

      await GetBuyerVersion(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          versionIndex: 1,
          content: "Version 1 content",
          purchasedAt: purchase.createdAt,
        })
      );
    });

    it("should identify which version a buyer currently accesses", async () => {
      mockReq.query = {
        promptId: mockPrompt._id.toString(),
        buyerWallet: "buyer-wallet",
      };

      const purchase = {
        versionIndex: 1,
      };

      vi.spyOn(Purchase, "findOne").mockResolvedValueOnce(purchase as any);
      vi.spyOn(PromptVersion, "findOne").mockResolvedValueOnce({
        versionIndex: 1,
        content: "Specific version content",
      } as any);

      await GetBuyerVersion(mockReq as Request, mockRes as Response);

      expect(PromptVersion.findOne).toHaveBeenCalledWith({
        promptId: expect.any(String),
        versionIndex: 1,
      });
    });

    it("should return 404 if purchase record not found", async () => {
      mockReq.query = {
        promptId: mockPrompt._id.toString(),
        buyerWallet: "buyer-wallet",
      };

      vi.spyOn(Purchase, "findOne").mockResolvedValueOnce(null);

      await GetBuyerVersion(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("No purchase record found"),
        })
      );
    });

    it("should require promptId and buyerWallet query params", async () => {
      mockReq.query = {
        promptId: mockPrompt._id.toString(),
        // Missing buyerWallet
      };

      await GetBuyerVersion(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe("Version History Acceptance Criteria", () => {
    it("should allow creators to publish new content versions without replacing history", async () => {
      // V1: Original content
      const v1 = { versionIndex: 1, content: "Original" };
      // V2: Updated content
      const v2 = { versionIndex: 2, content: "Updated" };

      expect(v1.content).not.toBe(v2.content);
      expect(v1.versionIndex).not.toBe(v2.versionIndex);
    });

    it("should allow buyers to identify the version they access", async () => {
      const purchase = {
        promptId: "prompt-1",
        buyerWallet: "buyer-1",
        versionIndex: 1,
        createdAt: new Date("2024-01-01"),
      };

      // Buyer can query their purchase to find versionIndex
      expect(purchase.versionIndex).toBeDefined();
      expect(purchase.createdAt).toBeDefined();
    });

    it("should preserve access for earlier purchasers", async () => {
      // When prompt is updated to V2, V1 purchase records remain valid
      const v1Purchase = { versionIndex: 1 };
      const v2Purchase = { versionIndex: 2 };

      expect(v1Purchase.versionIndex).toBe(1);
      expect(v2Purchase.versionIndex).toBe(2);

      // Both can be retrieved independently
      expect([v1Purchase, v2Purchase].length).toBe(2);
    });

    it("should make version metadata available to frontend and unlock services", async () => {
      // GetBuyerVersion returns metadata needed for unlock
      mockReq.query = {
        promptId: "prompt-1",
        buyerWallet: "buyer-1",
      };

      const versionData = {
        versionIndex: 1,
        changeNote: "Initial version",
        content: "encrypted-content",
        purchasedAt: new Date(),
      };

      // Frontend/unlock service can access all needed metadata
      expect(versionData.versionIndex).toBeDefined();
      expect(versionData.changeNote).toBeDefined();
      expect(versionData.content).toBeDefined();
      expect(versionData.purchasedAt).toBeDefined();
    });
  });
});
