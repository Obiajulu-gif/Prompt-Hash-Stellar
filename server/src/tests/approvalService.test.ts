import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock DB connection
vi.mock("../db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(true),
}));

// Mock mongoose models
vi.mock("../models/Prompt", () => {
  const m: any = {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    lean: vi.fn().mockResolvedValue({}),
    exec: vi.fn().mockResolvedValue({}),
  };
  return m;
});

vi.mock("../models/User", () => {
  const m: any = {
    findOne: vi.fn(),
    create: vi.fn().mockResolvedValue({ _id: "user-1", walletAddress: "test-wallet" }),
  };
  return m;
});

vi.mock("../models/OwnershipTransfer", () => {
  const m: any = {
    findById: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  };
  return m;
});

vi.mock("../models/Approval", () => {
  const m: any = {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    create: vi.fn(),
  };
  return m;
});

import { ApprovalService } from "../services/approvalService";
import { Request, Response } from "express";

describe("Approval Service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("ApprovalService.createApproval", () => {
    it("should create an approval with correct fields", async () => {
      (ApprovalService as any).createApproval = vi.fn().mockResolvedValue({
        _id: "approval-1",
        actionId: "transfer-1",
        actionType: "ownershipTransfer",
        scope: "TRANSFER",
        reason: "Test reason",
        actor: "maintainer-1",
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        status: "pending",
      });

      const result = await (ApprovalService as any).createApproval({
        actionId: "transfer-1",
        actionType: "ownershipTransfer",
        scope: "TRANSFER",
        reason: "Test reason",
        actor: "maintainer-1",
        durationMinutes: 60,
      });

      expect(result.actionId).toBe("transfer-1");
      expect(result.scope).toBe("TRANSFER");
      expect(result.reason).toBe("Test reason");
      expect(result.status).toBe("pending");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe("ApprovalService.evaluateApproval", () => {
    beforeEach(() => {
      // Mock Approval.findOne
      (Approval.findOne as any).mockResolvedValueOnce({
        _id: "approval-1",
        actionId: "transfer-1",
        actionType: "ownershipTransfer",
        scope: "TRANSFER",
        reason: "Test reason",
        actor: "maintainer-1",
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        status: "pending",
      });
    });

    it("should approve valid pending approval", async () => {
      const result = await ApprovalService.evaluateApproval({
        approvalId: "approval-1",
        actor: "maintainer-1",
        scope: "TRANSFER",
        actionPath: "/api/prompts/transfers/respond",
      });

      expect(result.approved).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.scopeMismatch).toBe(false);
      expect(result.expired).toBe(false);
    });

    it("should reject expired approval", async () => {
      // Mock expired approval
      (Approval.findOne as any).mockResolvedValueOnce({
        _id: "approval-1",
        actionId: "transfer-1",
        actionType: "ownershipTransfer",
        scope: "TRANSFER",
        reason: "Test reason",
        actor: "maintainer-1",
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() - 60 * 60 * 1000), // expired 1 hour ago
        status: "pending",
      });

      const result = await ApprovalService.evaluateApproval({
        approvalId: "approval-1",
        actor: "maintainer-1",
        scope: "TRANSFER",
        actionPath: "/api/prompts/transfers/respond",
      });

      expect(result.approved).toBe(false);
      expect(result.expired).toBe(true);
      expect(result.reason).toContain("expired");
    });

    it("should reject with scope mismatch when actor doesn't match", async () => {
      (Approval.findOne as any).mockResolvedValueOnce({
        _id: "approval-1",
        actionId: "transfer-1",
        actionType: "ownershipTransfer",
        scope: "TRANSFER",
        reason: "Test reason",
        actor: "other-maintainer", // different actor
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        status: "pending",
      });

      const result = await ApprovalService.evaluateApproval({
        approvalId: "approval-1",
        actor: "maintainer-1", // different actor
        scope: "TRANSFER",
        actionPath: "/api/prompts/transfers/respond",
      });

      expect(result.approved).toBe(false);
      expect(result.scopeMismatch).toBe(true);
      expect(result.reason).toContain("actor mismatch");
    });

    it("should reject when no approval found", async () => {
      (Approval.findOne as any).mockResolvedValueOnce(null);

      const result = await ApprovalService.evaluateApproval({
        approvalId: "non-existent",
        actor: "maintainer-1",
        scope: "TRANSFER",
        actionPath: "/api/prompts/transfers/respond",
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("No approval found");
      expect(result.scopeMismatch).toBe(false);
      expect(result.expired).toBe(false);
    });
  });

  describe("ApprovalService.checkProtectedActionApproval", () => {
    beforeEach(() => {
      // Mock: no pending approval, but there's an approved one
      (Approval.findOne as any)
        .mockResolvedValueOnce(null) // no pending
        .mockResolvedValueOnce({
          _id: "approval-2",
          actionId: "transfer-2",
          actionType: "ownershipTransfer",
          scope: "TRANSFER",
          reason: "Approved earlier",
          actor: "maintainer-1",
          approvedAt: new Date(Date.now() - 30 * 1000),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          status: "approved",
        });
    });

    it("should accept when there's a valid approved approval (no pending)", async () => {
      const result = await ApprovalService.checkProtectedActionApproval({
        actionId: "transfer-2",
        actionType: "ownershipTransfer",
        scope: "TRANSFER",
        actor: "maintainer-1",
        actionPath: "/api/prompts/transfers/respond",
      });

      expect(result.requiresApproval).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.scopeMismatch).toBe(false);
      expect(result.expired).toBe(false);
    });

    it("should reject when no valid approval exists at all", async () => {
      // Mock: no pending AND no approved
      (Approval.findOne as any)
        .mockResolvedValueOnce(null) // no pending
        .mockResolvedValueOnce(null); // no approved either

      const result = await ApprovalService.checkProtectedActionApproval({
        actionId: "transfer-nonexistent",
        actionType: "ownershipTransfer",
        scope: "TRANSFER",
        actor: "maintainer-1",
        actionPath: "/api/prompts/transfers/respond",
      });

      expect(result.requiresApproval).toBe(true);
      expect(result.approved).toBe(false);
      expect(result.reason).toContain("No valid approval");
      expect(result.scopeMismatch).toBe(false);
      expect(result.expired).toBe(false);
    });

    it("should reject when approval is expired", async () => {
      // Mock: pending approval that's expired
      (Approval.findOne as any).mockResolvedValueOnce({
        _id: "approval-3",
        actionId: "transfer-3",
        actionType: "ownershipTransfer",
        scope: "TRANSFER",
        reason: "Expired approval",
        actor: "maintainer-1",
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() - 60 * 60 * 1000), // expired
        status: "pending",
      });

      const result = await ApprovalService.checkProtectedActionApproval({
        actionId: "transfer-3",
        actionType: "ownershipTransfer",
        scope: "TRANSFER",
        actor: "maintainer-1",
        actionPath: "/api/prompts/transfers/respond",
      });

      expect(result.requiresApproval).toBe(true);
      expect(result.approved).toBe(false);
      expect(result.expired).toBe(true);
      expect(result.reason).toContain("expired");
    });
  });
});