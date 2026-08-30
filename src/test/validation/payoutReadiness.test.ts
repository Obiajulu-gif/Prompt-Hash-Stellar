/**
 * Tests for payout readiness validation logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validatePayoutReadiness,
  checkCreatorPayoutReadiness,
  shouldBlockPaidPublication,
  getBlockingIssues,
  getPayoutPreferences,
  type CreatorReadinessData,
  type PayoutPreferences,
} from "@/lib/validation/payoutReadiness";
import type { CreatorProfile } from "@/lib/profiles/creatorProfile";

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

describe("payoutReadiness validation", () => {
  const mockAddress = "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
  const mockInvalidAddress = "INVALID_ADDRESS";
  const mockPayoutAddress = "GDPAYOUTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("validatePayoutReadiness", () => {
    it("should pass all checks for a fully ready creator", () => {
      const readyData: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "Test Creator",
          bio: "I create amazing prompts",
          websiteUrl: "",
          avatarUrl: "",
          twitterHandle: "",
          verified: false,
          updatedAt: new Date().toISOString(),
        },
        payoutPreferences: {
          payoutAddress: mockPayoutAddress,
        },
        walletBalance: "5.0",
      };

      const result = validatePayoutReadiness(readyData);

      expect(result.isReady).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.checks).toHaveLength(4);
      expect(result.checks.every(check => check.status === "pass" || check.status === "warn")).toBe(true);
    });

    it("should block when wallet is not connected", () => {
      const data: CreatorReadinessData = {
        address: "",
        profile: null,
        payoutPreferences: null,
        walletBalance: undefined,
      };

      const result = validatePayoutReadiness(data);

      expect(result.isReady).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(0);
      expect(result.blockers).toContain("Connect your Stellar wallet to receive payments");
    });

    it("should block when wallet address is invalid", () => {
      const data: CreatorReadinessData = {
        address: mockInvalidAddress,
        profile: null,
        payoutPreferences: null,
        walletBalance: undefined,
      };

      const result = validatePayoutReadiness(data);

      expect(result.isReady).toBe(false);
      expect(result.blockers).toContain("Invalid Stellar wallet address format");
    });

    it("should block when payout destination is missing", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "Test Creator",
          bio: "I create amazing prompts",
          websiteUrl: "",
          avatarUrl: "",
          twitterHandle: "",
          verified: false,
          updatedAt: new Date().toISOString(),
        },
        payoutPreferences: null,
        walletBalance: "5.0",
      };

      const result = validatePayoutReadiness(data);

      expect(result.isReady).toBe(false);
      expect(result.blockers).toContain("Set up your payout address to receive earnings");
    });

    it("should block when payout address is invalid", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "Test Creator",
          bio: "I create amazing prompts",
          websiteUrl: "",
          avatarUrl: "",
          twitterHandle: "",
          verified: false,
          updatedAt: new Date().toISOString(),
        },
        payoutPreferences: {
          payoutAddress: "INVALID_PAYOUT_ADDRESS",
        },
        walletBalance: "5.0",
      };

      const result = validatePayoutReadiness(data);

      expect(result.isReady).toBe(false);
      expect(result.blockers).toContain("Invalid payout address format");
    });

    it("should block when creator profile is missing", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: null,
        payoutPreferences: {
          payoutAddress: mockPayoutAddress,
        },
        walletBalance: "5.0",
      };

      const result = validatePayoutReadiness(data);

      expect(result.isReady).toBe(false);
      expect(result.blockers).toContain("Complete your creator profile before listing paid prompts");
    });

    it("should block when creator profile is incomplete (missing required fields)", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "", // Missing required field
          bio: "",         // Missing required field
          websiteUrl: "",
          avatarUrl: "",
          twitterHandle: "",
          verified: false,
          updatedAt: new Date().toISOString(),
        },
        payoutPreferences: {
          payoutAddress: mockPayoutAddress,
        },
        walletBalance: "5.0",
      };

      const result = validatePayoutReadiness(data);

      expect(result.isReady).toBe(false);
      expect(result.blockers.some(blocker => blocker.includes("display name, bio"))).toBe(true);
    });

    it("should block when XLM balance is insufficient", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "Test Creator",
          bio: "I create amazing prompts",
          websiteUrl: "",
          avatarUrl: "",
          twitterHandle: "",
          verified: false,
          updatedAt: new Date().toISOString(),
        },
        payoutPreferences: {
          payoutAddress: mockPayoutAddress,
        },
        walletBalance: "0.5", // Below minimum threshold
      };

      const result = validatePayoutReadiness(data);

      expect(result.isReady).toBe(false);
      expect(result.blockers.some(blocker => blocker.includes("Add at least 1 XLM"))).toBe(true);
    });

    it("should warn when payout address is same as wallet address", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "Test Creator",
          bio: "I create amazing prompts",
          websiteUrl: "",
          avatarUrl: "",
          twitterHandle: "",
          verified: false,
          updatedAt: new Date().toISOString(),
        },
        payoutPreferences: {
          payoutAddress: mockAddress, // Same as wallet address
        },
        walletBalance: "5.0",
      };

      const result = validatePayoutReadiness(data);

      expect(result.isReady).toBe(true); // Should still be ready
      expect(result.warnings.some(warning => 
        warning.includes("Using same address for wallet and payouts")
      )).toBe(true);
    });

    it("should warn when XLM balance is low but sufficient", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "Test Creator",
          bio: "I create amazing prompts",
          websiteUrl: "",
          avatarUrl: "",
          twitterHandle: "",
          verified: false,
          updatedAt: new Date().toISOString(),
        },
        payoutPreferences: {
          payoutAddress: mockPayoutAddress,
        },
        walletBalance: "1.5", // Low but above minimum
      };

      const result = validatePayoutReadiness(data);

      expect(result.isReady).toBe(true); // Should still be ready
      expect(result.warnings.some(warning => 
        warning.includes("Low XLM balance")
      )).toBe(true);
    });

    it("should warn when creator profile is missing optional fields", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "Test Creator",
          bio: "I create amazing prompts",
          websiteUrl: "", // Missing optional field
          avatarUrl: "",  // Missing optional field
          twitterHandle: "", // Missing optional field
          verified: false,
          updatedAt: new Date().toISOString(),
        },
        payoutPreferences: {
          payoutAddress: mockPayoutAddress,
        },
        walletBalance: "5.0",
      };

      const result = validatePayoutReadiness(data);

      expect(result.isReady).toBe(true); // Should still be ready
      expect(result.warnings.some(warning => 
        warning.includes("Consider adding")
      )).toBe(true);
    });
  });

  describe("getPayoutPreferences", () => {
    it("should return payout preferences from localStorage", () => {
      const mockPrefs: PayoutPreferences = {
        payoutAddress: mockPayoutAddress,
      };

      localStorageMock.getItem.mockReturnValue(JSON.stringify(mockPrefs));

      const result = getPayoutPreferences(mockAddress);

      expect(result).toEqual(mockPrefs);
      expect(localStorageMock.getItem).toHaveBeenCalledWith(`prompt-hash:payout:${mockAddress}`);
    });

    it("should return null when no preferences exist", () => {
      localStorageMock.getItem.mockReturnValue(null);

      const result = getPayoutPreferences(mockAddress);

      expect(result).toBeNull();
    });

    it("should return null when localStorage data is corrupted", () => {
      localStorageMock.getItem.mockReturnValue("invalid-json");

      const result = getPayoutPreferences(mockAddress);

      expect(result).toBeNull();
    });
  });

  describe("checkCreatorPayoutReadiness", () => {
    it("should integrate all data sources and validate readiness", () => {
      const mockPrefs: PayoutPreferences = {
        payoutAddress: mockPayoutAddress,
      };
      const mockProfile: CreatorProfile = {
        address: mockAddress,
        displayName: "Test Creator",
        bio: "I create amazing prompts",
        websiteUrl: "",
        avatarUrl: "",
        twitterHandle: "",
        verified: false,
        updatedAt: new Date().toISOString(),
      };

      localStorageMock.getItem.mockReturnValue(JSON.stringify(mockPrefs));

      const result = checkCreatorPayoutReadiness(mockAddress, mockProfile, "5.0");

      expect(result.isReady).toBe(true);
      expect(result.checks).toHaveLength(4);
    });
  });

  describe("utility functions", () => {
    it("shouldBlockPaidPublication should return correct boolean", () => {
      const readyResult = {
        isReady: true,
        checks: [],
        blockers: [],
        warnings: [],
      };
      const notReadyResult = {
        isReady: false,
        checks: [],
        blockers: ["Some issue"],
        warnings: [],
      };

      expect(shouldBlockPaidPublication(readyResult)).toBe(false);
      expect(shouldBlockPaidPublication(notReadyResult)).toBe(true);
    });

    it("getBlockingIssues should return array of blocking issues", () => {
      const result = {
        isReady: false,
        checks: [],
        blockers: ["Issue 1", "Issue 2"],
        warnings: ["Warning 1"],
      };

      expect(getBlockingIssues(result)).toEqual(["Issue 1", "Issue 2"]);
    });
  });

  describe("edge cases", () => {
    it("should handle missing wallet balance gracefully", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "Test Creator",
          bio: "I create amazing prompts",
          websiteUrl: "",
          avatarUrl: "",
          twitterHandle: "",
          verified: false,
          updatedAt: new Date().toISOString(),
        },
        payoutPreferences: {
          payoutAddress: mockPayoutAddress,
        },
        walletBalance: undefined,
      };

      const result = validatePayoutReadiness(data);

      const settlementCheck = result.checks.find(c => c.id === "settlement-readiness");
      expect(settlementCheck?.status).toBe("warn");
      expect(settlementCheck?.message).toContain("Unable to verify wallet balance");
    });

    it("should handle invalid balance gracefully", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "Test Creator",
          bio: "I create amazing prompts",
          websiteUrl: "",
          avatarUrl: "",
          twitterHandle: "",
          verified: false,
          updatedAt: new Date().toISOString(),
        },
        payoutPreferences: {
          payoutAddress: mockPayoutAddress,
        },
        walletBalance: "not-a-number",
      };

      const result = validatePayoutReadiness(data);

      const settlementCheck = result.checks.find(c => c.id === "settlement-readiness");
      expect(settlementCheck?.status).toBe("fail");
    });

    it("should handle empty payout address (should use wallet address)", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "Test Creator",
          bio: "I create amazing prompts",
          websiteUrl: "",
          avatarUrl: "",
          twitterHandle: "",
          verified: false,
          updatedAt: new Date().toISOString(),
        },
        payoutPreferences: {
          payoutAddress: "",
        },
        walletBalance: "5.0",
      };

      const result = validatePayoutReadiness(data);

      const payoutCheck = result.checks.find(c => c.id === "payout-destination");
      expect(payoutCheck?.status).toBe("fail");
      expect(payoutCheck?.message).toContain("Set up your payout address");
    });
  });
});