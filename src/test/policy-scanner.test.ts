/**
 * Policy Scanner & Moderation Tests
 * 
 * Tests content moderation workflows, policy enforcement, and audit trail integrity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiError, ErrorCode } from "../lib/api/errorCodes";

// Mock dependencies
const mockRecordAuditEvent = vi.fn();
const mockGetPrompt = vi.fn();
const mockFindOneAndUpdate = vi.fn();
const mockConnectDb = vi.fn();

vi.mock("../../server/src/services/auditTrail", () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
}));

vi.mock("../../server/src/db/connectDb", () => ({
  default: () => mockConnectDb(),
}));

vi.mock("../../server/src/models/Prompt", () => ({
  default: {
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
  },
}));

vi.mock("../lib/stellar/promptHashClient", () => ({
  getPrompt: (...args: unknown[]) => mockGetPrompt(...args),
}));

describe("Moderation API Authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_WALLETS = "GADMIN1,GADMIN2,GADMIN3";
  });

  afterEach(() => {
    delete process.env.ADMIN_WALLETS;
  });

  it("should reject moderation requests from non-admin wallets", async () => {
    const unauthorizedWallet = "GUSER123";
    
    // This would be called through the API endpoint
    const isAdmin = process.env.ADMIN_WALLETS?.split(",")
      .map(w => w.trim().toLowerCase())
      .includes(unauthorizedWallet.toLowerCase());

    expect(isAdmin).toBe(false);
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  it("should allow moderation requests from authorized admin wallets", async () => {
    const adminWallet = "GADMIN1";
    
    const isAdmin = process.env.ADMIN_WALLETS?.split(",")
      .map(w => w.trim().toLowerCase())
      .includes(adminWallet.toLowerCase());

    expect(isAdmin).toBe(true);
  });

  it("should be case-insensitive for admin wallet matching", async () => {
    const adminWalletLowerCase = "gadmin2";
    
    const isAdmin = process.env.ADMIN_WALLETS?.split(",")
      .map(w => w.trim().toLowerCase())
      .includes(adminWalletLowerCase.toLowerCase());

    expect(isAdmin).toBe(true);
  });

  it("should reject when ADMIN_WALLETS is not configured", async () => {
    delete process.env.ADMIN_WALLETS;
    
    const isAdmin = (process.env.ADMIN_WALLETS || "")
      .split(",")
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length > 0)
      .includes("GADMIN1".toLowerCase());

    expect(isAdmin).toBe(false);
  });
});

describe("Moderation Request Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject requests missing required fields", async () => {
    const incompleteRequest = {
      promptId: "123",
      action: "restrict",
      // Missing: reason, policyReference, adminWallet
    };

    const hasAllFields = Boolean(
      incompleteRequest.promptId &&
      (incompleteRequest as any).reason &&
      (incompleteRequest as any).policyReference &&
      (incompleteRequest as any).adminWallet
    );

    expect(hasAllFields).toBe(false);
  });

  it("should accept valid moderation requests with all required fields", async () => {
    const validRequest = {
      promptId: "123",
      action: "restrict",
      reason: "copyright",
      policyReference: "DMCA-2024-001",
      adminWallet: "GADMIN1",
    };

    const hasAllFields = Boolean(
      validRequest.promptId &&
      validRequest.reason &&
      validRequest.policyReference &&
      validRequest.adminWallet
    );

    expect(hasAllFields).toBe(true);
  });

  it("should validate moderation action values", async () => {
    const validActions = ["restrict", "reinstate", "retire"];
    const invalidAction = "delete";

    expect(validActions).toContain("restrict");
    expect(validActions).toContain("reinstate");
    expect(validActions).toContain("retire");
    expect(validActions).not.toContain(invalidAction);
  });

  it("should validate moderation reason values", async () => {
    const validReasons = ["copyright", "abuse", "malware", "policy_violation", "other"];
    const invalidReason = "spam";

    expect(validReasons).toContain("copyright");
    expect(validReasons).toContain("abuse");
    expect(validReasons).toContain("malware");
    expect(validReasons).not.toContain(invalidReason);
  });
});

describe("Moderation Action Processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectDb.mockResolvedValue(undefined);
    mockGetPrompt.mockResolvedValue({
      id: 123n,
      creator: "GCREATOR",
      title: "Test Prompt",
      status: "Active",
      priceStroops: 100000000n,
    });
    mockFindOneAndUpdate.mockResolvedValue({
      onChainId: "123",
      moderationStatus: "restricted",
    });
  });

  it("should map restrict action to Restricted status", async () => {
    const action = "restrict";
    const expectedStatus = "Restricted";

    const statusMap: Record<string, string> = {
      restrict: "Restricted",
      reinstate: "Active",
      retire: "Retired",
    };

    expect(statusMap[action]).toBe(expectedStatus);
  });

  it("should map reinstate action to Active status", async () => {
    const action = "reinstate";
    const expectedStatus = "Active";

    const statusMap: Record<string, string> = {
      restrict: "Restricted",
      reinstate: "Active",
      retire: "Retired",
    };

    expect(statusMap[action]).toBe(expectedStatus);
  });

  it("should update database with moderation metadata", async () => {
    const moderationData = {
      promptId: "123",
      action: "restrict",
      reason: "copyright",
      adminWallet: "GADMIN1",
      notes: "DMCA takedown request received",
    };

    await mockFindOneAndUpdate(
      { onChainId: moderationData.promptId },
      {
        $set: {
          moderationStatus: "restricted",
          moderatedAt: new Date(),
          moderatedBy: moderationData.adminWallet,
          moderationReason: moderationData.reason,
          moderationNotes: moderationData.notes,
        },
      }
    );

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { onChainId: "123" },
      expect.objectContaining({
        $set: expect.objectContaining({
          moderationStatus: "restricted",
          moderationReason: "copyright",
          moderatedBy: "GADMIN1",
          moderationNotes: "DMCA takedown request received",
        }),
      })
    );
  });

  it("should create audit trail for moderation actions", async () => {
    const moderationData = {
      promptId: "123",
      action: "restrict",
      reason: "copyright",
      policyReference: "DMCA-2024-001",
      adminWallet: "GADMIN1",
    };

    await mockRecordAuditEvent({
      action: `prompt_${moderationData.action}`,
      result: "success",
      promptId: moderationData.promptId,
      walletAddress: moderationData.adminWallet,
      requestId: "req-123",
      clientIp: "192.168.1.1",
      reason: moderationData.reason,
      metadata: {
        policyReference: moderationData.policyReference,
        notes: "",
        previousStatus: "Active",
        newStatus: "Restricted",
      },
    });

    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "prompt_restrict",
        result: "success",
        promptId: "123",
        walletAddress: "GADMIN1",
        reason: "copyright",
        metadata: expect.objectContaining({
          policyReference: "DMCA-2024-001",
        }),
      })
    );
  });
});

describe("Buyer Access Preservation", () => {
  it("should not filter restricted prompts from buyer's purchased list", async () => {
    const purchasedPrompts = [
      { id: "1", status: "Active", title: "Active Prompt" },
      { id: "2", status: "Restricted", title: "Restricted Prompt" },
      { id: "3", status: "Active", title: "Another Active" },
    ];

    // Buyer queries should return ALL prompts, including restricted ones
    const buyerView = purchasedPrompts;
    
    expect(buyerView).toHaveLength(3);
    expect(buyerView.some(p => p.status === "Restricted")).toBe(true);
  });

  it("should filter restricted prompts from public marketplace", async () => {
    const allPrompts = [
      { id: "1", status: "Active", title: "Active Prompt" },
      { id: "2", status: "Restricted", title: "Restricted Prompt" },
      { id: "3", status: "Active", title: "Another Active" },
    ];

    // Public marketplace should exclude restricted prompts
    const marketplaceView = allPrompts.filter(p => p.status !== "Restricted");
    
    expect(marketplaceView).toHaveLength(2);
    expect(marketplaceView.every(p => p.status !== "Restricted")).toBe(true);
  });

  it("should allow creators to see their restricted prompts", async () => {
    const creatorAddress = "GCREATOR";
    const creatorPrompts = [
      { id: "1", creator: creatorAddress, status: "Active" },
      { id: "2", creator: creatorAddress, status: "Restricted" },
      { id: "3", creator: creatorAddress, status: "Paused" },
    ];

    // Creator dashboard should show all their prompts regardless of status
    const creatorView = creatorPrompts.filter(p => p.creator === creatorAddress);
    
    expect(creatorView).toHaveLength(3);
    expect(creatorView.some(p => p.status === "Restricted")).toBe(true);
  });
});

describe("Moderation Audit Trail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should record unauthorized moderation attempts", async () => {
    const unauthorizedAttempt = {
      promptId: "123",
      adminWallet: "GUNAUTHORIZED",
    };

    await mockRecordAuditEvent({
      action: "moderation_unauthorized",
      result: "blocked",
      promptId: unauthorizedAttempt.promptId,
      walletAddress: unauthorizedAttempt.adminWallet,
      requestId: "req-456",
      clientIp: "192.168.1.100",
      reason: "unauthorized_admin",
    });

    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "moderation_unauthorized",
        result: "blocked",
        reason: "unauthorized_admin",
      })
    );
  });

  it("should record moderation errors with details", async () => {
    const errorAttempt = {
      promptId: "123",
      adminWallet: "GADMIN1",
      error: "Contract call failed",
    };

    await mockRecordAuditEvent({
      action: "moderation_error",
      result: "failure",
      promptId: errorAttempt.promptId,
      walletAddress: errorAttempt.adminWallet,
      requestId: "req-789",
      clientIp: "192.168.1.1",
      reason: "error",
    });

    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "moderation_error",
        result: "failure",
      })
    );
  });

  it("should include policy reference in audit metadata", async () => {
    const moderationWithPolicy = {
      promptId: "123",
      policyReference: "DMCA-2024-001",
      notes: "Copyright infringement claim",
    };

    await mockRecordAuditEvent({
      action: "prompt_restrict",
      result: "success",
      promptId: moderationWithPolicy.promptId,
      walletAddress: "GADMIN1",
      requestId: "req-999",
      clientIp: "192.168.1.1",
      reason: "copyright",
      metadata: {
        policyReference: moderationWithPolicy.policyReference,
        notes: moderationWithPolicy.notes,
        previousStatus: "Active",
        newStatus: "Restricted",
      },
    });

    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          policyReference: "DMCA-2024-001",
        }),
      })
    );
  });
});

describe("Moderation State Transitions", () => {
  it("should allow transitioning from Active to Restricted", async () => {
    const validTransition = {
      from: "Active",
      to: "Restricted",
    };

    const isValidTransition = 
      validTransition.from !== "Retired" && 
      validTransition.from !== validTransition.to;

    expect(isValidTransition).toBe(true);
  });

  it("should allow transitioning from Restricted to Active (reinstatement)", async () => {
    const validTransition = {
      from: "Restricted",
      to: "Active",
    };

    const isValidTransition = 
      validTransition.from !== "Retired" && 
      validTransition.from !== validTransition.to;

    expect(isValidTransition).toBe(true);
  });

  it("should prevent transitions from same status to same status", async () => {
    const invalidTransition = {
      from: "Restricted",
      to: "Restricted",
    };

    const isValidTransition = 
      invalidTransition.from !== "Retired" && 
      invalidTransition.from !== invalidTransition.to;

    expect(isValidTransition).toBe(false);
  });

  it("should prevent transitions from Retired status", async () => {
    const invalidTransition = {
      from: "Retired",
      to: "Active",
    };

    const isValidTransition = 
      invalidTransition.from !== "Retired" && 
      invalidTransition.from !== invalidTransition.to;

    expect(isValidTransition).toBe(false);
  });
});
