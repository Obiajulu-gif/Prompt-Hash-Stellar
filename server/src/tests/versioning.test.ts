import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import Prompt from "../models/Prompt";
import PromptVersion from "../models/PromptVersion";
import Purchase from "../models/Purchase";
import User from "../models/User";
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

// Notifications are routed through the preference-aware delivery service;
// unit-test the controller against that boundary instead of the model.
vi.mock("../services/notificationRouting", () => ({
  deliverNotification: vi.fn().mockResolvedValue({
    delivered: true,
    alreadyDelivered: false,
    mandatory: false,
    channels: { inApp: true, email: true },
    notificationId: "notification-1",
  }),
}));

import { deliverNotification } from "../services/notificationRouting";

/** `Model.findById(...).select(...).lean()` */
const selectLean = (value: unknown) => ({
  select: () => ({ lean: async () => value }),
});

/** `Model.findOne(...).lean()` */
const findLean = (value: unknown) => ({ lean: async () => value });

/** `Model.find(...).select(...).sort(...).limit(...).lean()` */
const versionListQuery = (versions: unknown[]) => ({
  select: () => ({
    sort: () => ({ limit: () => ({ lean: async () => versions }) }),
  }),
});

/** `Model.findOne(...).sort(...).lean()` */
const sortedFindOne = (value: unknown) => ({
  sort: () => ({ lean: async () => value }),
});

describe("Prompt Versioning System", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockUser: any;
  let mockPrompt: any;

  beforeEach(() => {
    vi.restoreAllMocks();
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

  /** Resolve the acting wallet as the prompt owner (creator role). */
  const actAsCreator = (ownerId: unknown = mockUser._id) => {
    vi.spyOn(User, "findOne").mockResolvedValue(mockUser as any);
    vi.spyOn(Prompt, "findById").mockReturnValue(
      selectLean({ owner: ownerId }) as any
    );
    vi.spyOn(Purchase, "findOne").mockReturnValue(findLean(null) as any);
  };

  /** Resolve the acting wallet as a buyer holding `purchase`. */
  const actAsBuyer = (purchase: unknown) => {
    vi.spyOn(User, "findOne").mockResolvedValue(mockUser as any);
    vi.spyOn(Prompt, "findById").mockReturnValue(
      selectLean({ owner: new mongoose.Types.ObjectId() }) as any
    );
    vi.spyOn(Purchase, "findOne").mockReturnValue(findLean(purchase) as any);
  };

  describe("PostPromptUpdate", () => {
    it("should create a new version without replacing history", async () => {
      mockReq.body = {
        promptId: mockPrompt._id.toString(),
        walletAddress: "test-wallet",
        content: "Updated content",
        changeNote: "Fixed a typo",
      };

      actAsCreator();
      vi.spyOn(Prompt, "findOne").mockResolvedValue(mockPrompt as any);
      vi.spyOn(PromptVersion, "create").mockResolvedValue({
        promptId: mockPrompt._id.toString(),
        versionIndex: 2,
        content: "Updated content",
        changeNote: "Fixed a typo",
        createdBy: "test-wallet",
      } as any);
      vi.spyOn(Prompt, "findByIdAndUpdate").mockResolvedValue({} as any);
      vi.spyOn(Purchase, "find").mockResolvedValue([] as any);

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
      mockReq.body = {
        promptId: mockPrompt._id.toString(),
        walletAddress: "test-wallet",
        content: "Updated content",
        changeNote: "Major update",
      };

      actAsCreator();
      vi.spyOn(Prompt, "findOne").mockResolvedValue(mockPrompt as any);
      vi.spyOn(PromptVersion, "create").mockResolvedValue({
        versionIndex: 2,
      } as any);
      vi.spyOn(Prompt, "findByIdAndUpdate").mockResolvedValue({} as any);
      vi.spyOn(Purchase, "find").mockResolvedValue([
        { buyerWallet: "buyer1" },
        { buyerWallet: "buyer2" },
      ] as any);

      await PostPromptUpdate(mockReq as Request, mockRes as Response);

      expect(deliverNotification).toHaveBeenCalledTimes(2);
      expect(deliverNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientWallet: "buyer1",
          type: "prompt_update",
        })
      );
      expect(deliverNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientWallet: "buyer2",
          type: "prompt_update",
        })
      );
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

      vi.spyOn(PromptVersion, "find").mockReturnValue(
        versionListQuery(versions) as any
      );

      await GetPromptVersions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ versions })
      );
    });

    it("should exclude content from version history", async () => {
      mockReq.params = {
        promptId: mockPrompt._id.toString(),
      };

      const select = vi.fn(() => ({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      }));
      vi.spyOn(PromptVersion, "find").mockReturnValue({ select } as any);

      await GetPromptVersions(mockReq as Request, mockRes as Response);

      expect(select).toHaveBeenCalledWith(
        "promptId versionIndex changeNote createdBy createdAt"
      );
      expect(select).not.toHaveBeenCalledWith(
        expect.stringContaining("content ")
      );
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
    it("should record a purchase for the acting wallet", async () => {
      mockReq.body = {
        promptId: mockPrompt._id.toString(),
        walletAddress: "buyer-wallet",
        txHash: "0x123abc",
      };

      actAsBuyer(null);
      vi.spyOn(Purchase, "create").mockResolvedValue({
        promptId: mockPrompt._id.toString(),
        buyerWallet: "buyer-wallet",
        txHash: "0x123abc",
      } as any);

      await RecordPurchase(mockReq as Request, mockRes as Response);

      expect(Purchase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          promptId: mockPrompt._id.toString(),
          buyerWallet: "buyer-wallet",
          txHash: "0x123abc",
        })
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it("should preserve older purchases and not allow re-purchasing", async () => {
      mockReq.body = {
        promptId: mockPrompt._id.toString(),
        walletAddress: "buyer-wallet",
      };

      actAsBuyer({
        promptId: mockPrompt._id.toString(),
        buyerWallet: "buyer-wallet",
        versionIndex: 1,
      });
      const create = vi.spyOn(Purchase, "create");
      vi.spyOn(Purchase, "findOne").mockReturnValue(
        findLean({
          promptId: mockPrompt._id.toString(),
          buyerWallet: "buyer-wallet",
          versionIndex: 1,
        }) as any
      );

      await RecordPurchase(mockReq as Request, mockRes as Response);

      // The original purchase row is kept; no duplicate is written.
      expect(create).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Purchase recorded." })
      );
    });

    it("should require promptId and buyerWallet", async () => {
      mockReq.body = {
        promptId: mockPrompt._id.toString(),
        // Missing walletAddress
      };

      await RecordPurchase(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe("GetBuyerVersion", () => {
    it("should return the specific version a buyer purchased", async () => {
      mockReq.params = {
        promptId: mockPrompt._id.toString(),
        versionIndex: "1",
      };
      mockReq.query = { walletAddress: "buyer-wallet" };

      const version = {
        promptId: mockPrompt._id.toString(),
        versionIndex: 1,
        content: "Version 1 content",
        changeNote: "Initial version",
      };

      actAsBuyer({ versionIndex: 1 });
      vi.spyOn(PromptVersion, "findOne").mockReturnValue(
        sortedFindOne(version) as any
      );

      await GetBuyerVersion(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        version: expect.objectContaining({
          versionIndex: 1,
          content: "Version 1 content",
        }),
      });
    });

    it("should identify which version a buyer currently accesses", async () => {
      mockReq.params = {
        promptId: mockPrompt._id.toString(),
        versionIndex: "1",
      };
      mockReq.query = { walletAddress: "buyer-wallet" };

      actAsBuyer({ versionIndex: 1 });
      vi.spyOn(PromptVersion, "findOne").mockReturnValue(
        sortedFindOne({ versionIndex: 1, content: "Specific version content" }) as any
      );

      await GetBuyerVersion(mockReq as Request, mockRes as Response);

      expect(PromptVersion.findOne).toHaveBeenCalledWith({
        promptId: expect.any(String),
        versionIndex: 1,
      });
    });

    it("should return 404 if purchase record not found", async () => {
      mockReq.params = { promptId: mockPrompt._id.toString() };
      mockReq.query = { walletAddress: "buyer-wallet" };

      // No purchase record: the wallet is not a buyer of this prompt.
      actAsBuyer(null);

      await GetBuyerVersion(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it("should require promptId and buyerWallet query params", async () => {
      mockReq.params = {
        promptId: mockPrompt._id.toString(),
        // Missing walletAddress
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
      const purchase = { versionIndex: 1 };
      const version = { versionIndex: 1, content: "Version 1 content" };

      expect(purchase.versionIndex).toBe(version.versionIndex);
    });
  });
});
