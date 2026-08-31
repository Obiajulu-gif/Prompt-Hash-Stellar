/**
 * Tests for payout readiness validation logic and Stellar destination constraints (#678)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validatePayoutReadiness,
  checkCreatorPayoutReadiness,
  checkCreatorPayoutReadinessAsync,
  shouldBlockPaidPublication,
  getBlockingIssues,
  getPayoutPreferences,
  validatePayoutAddressFormat,
  verifyPayoutDestinationOnChain,
  type CreatorReadinessData,
  type PayoutPreferences,
} from "@/lib/validation/payoutReadiness";
import type { CreatorProfile } from "@/lib/profiles/creatorProfile";
import { Horizon } from "@stellar/stellar-sdk";

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("payoutReadiness validation", () => {
  const mockAddress = "GCB5YSIWR5LOBII4R3UHDWJUWVURKPKQSSZREP5N423JFPJCKIDTVLGH";
  const mockInvalidAddress = "INVALID_ADDRESS_12345";
  const mockPayoutAddress = "GB3SSVE3YZ3QSBARY7JLYINHWGXCPT2DUM2KMIEUDXGGVSJ5JOEAVDPS";
  const mockMuxedAddress = "MCB5YSIWR5LOBII4R3UHDWJUWVURKPKQSSZREP5N423JFPJCKIDTUAAAAAAAAABQHECTW";
  const mockSecretKey = "SCZANGBA5YHTNYVVV4C3U252E2B6P6F5T3U6MM63WBSBZATAQI3EBTQ4";
  const mockContractId = "CA3D5KRYMCMCZVAC7OHQHGNO2QQ74YQG082A829377J44Q3K3627Y2R3";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("validatePayoutAddressFormat", () => {
    it("should accept valid standard Ed25519 G-addresses", () => {
      const result = validatePayoutAddressFormat(mockPayoutAddress);
      expect(result.isValid).toBe(true);
      expect(result.isMuxed).toBe(false);
      expect(result.baseAddress).toBe(mockPayoutAddress);
      expect(result.type).toBe("standard");
    });

    it("should accept valid Muxed M-addresses (SEP-0023)", () => {
      const result = validatePayoutAddressFormat(mockMuxedAddress);
      expect(result.isValid).toBe(true);
      expect(result.isMuxed).toBe(true);
      expect(result.baseAddress).toBe(mockAddress);
      expect(result.muxedId).toBeDefined();
      expect(result.type).toBe("muxed");
    });

    it("should reject secret keys (S...)", () => {
      const result = validatePayoutAddressFormat(mockSecretKey);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Secret keys");
    });

    it("should reject contract IDs (C...)", () => {
      const result = validatePayoutAddressFormat(mockContractId);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Contract IDs");
    });

    it("should reject invalid address checksums", () => {
      const invalidChecksum = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2ZVOUSAC2WSRWZ7CXXX";
      const result = validatePayoutAddressFormat(invalidChecksum);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("checksum");
    });
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
      expect(result.checks.every((check) => check.status === "pass" || check.status === "warn")).toBe(true);
    });

    it("should pass when creator uses a valid Muxed Account", () => {
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
          payoutAddress: mockMuxedAddress,
        },
        walletBalance: "5.0",
      };

      const result = validatePayoutReadiness(data);
      expect(result.isReady).toBe(true);
      const payoutCheck = result.checks.find((c) => c.id === "payout-destination");
      expect(payoutCheck?.status).toBe("pass");
      expect(payoutCheck?.message).toContain("Muxed Account configured");
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
      expect(result.blockers.some((b) => b.includes("Invalid") || b.includes("Stellar"))).toBe(true);
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
      expect(result.blockers.some((b) => b.includes("Invalid") || b.includes("address"))).toBe(true);
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
          bio: "", // Missing required field
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
      expect(result.blockers.some((blocker) => blocker.includes("display name, bio"))).toBe(true);
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
      expect(result.blockers.some((blocker) => blocker.includes("Add at least 1 XLM"))).toBe(true);
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
      expect(
        result.warnings.some((warning) =>
          warning.includes("Using same address as connected wallet"),
        ),
      ).toBe(true);
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
      expect(result.warnings.some((warning) => warning.includes("Low XLM balance"))).toBe(true);
    });

    it("should warn when creator profile is missing optional fields", () => {
      const data: CreatorReadinessData = {
        address: mockAddress,
        profile: {
          address: mockAddress,
          displayName: "Test Creator",
          bio: "I create amazing prompts",
          websiteUrl: "", // Missing optional field
          avatarUrl: "", // Missing optional field
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
      expect(result.warnings.some((warning) => warning.includes("Consider adding"))).toBe(true);
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

  describe("on-chain and SEP-0029 memo verification", () => {
    it("should block memo-required exchange accounts when using standard G-address", async () => {
      const mockAccountCall = vi.fn().mockResolvedValue({
        id: mockAddress,
        balances: [{ asset_type: "native", balance: "100.0" }],
        data_attr: {
          "config.memo_required": "MQ==", // base64 of "1"
        },
      });

      vi.spyOn(Horizon.Server.prototype, "accounts").mockReturnValue({
        accountId: vi.fn().mockReturnValue({
          call: mockAccountCall,
        }),
      } as any);

      const verification = await verifyPayoutDestinationOnChain(mockAddress);
      expect(verification.status).toBe("memo_required_blocked");
      expect(verification.memoRequiredSep29).toBe(true);
      expect(verification.memoRequiredHandled).toBe(false);
      expect(verification.error).toContain("requires a memo (SEP-0029)");
    });

    it("should allow memo-required accounts when using a Muxed Account (M...)", async () => {
      const mockAccountCall = vi.fn().mockResolvedValue({
        id: mockAddress,
        balances: [{ asset_type: "native", balance: "100.0" }],
        data_attr: {
          "config.memo_required": "MQ==",
        },
      });

      vi.spyOn(Horizon.Server.prototype, "accounts").mockReturnValue({
        accountId: vi.fn().mockReturnValue({
          call: mockAccountCall,
        }),
      } as any);

      const verification = await verifyPayoutDestinationOnChain(mockMuxedAddress);
      expect(verification.status).toBe("verified");
      expect(verification.memoRequiredSep29).toBe(true);
      expect(verification.memoRequiredHandled).toBe(true);
      expect(verification.isMuxed).toBe(true);
    });

    it("should detect unfunded accounts via Horizon 404 response", async () => {
      const notFoundError: any = new Error("Account not found");
      notFoundError.response = { status: 404 };

      vi.spyOn(Horizon.Server.prototype, "accounts").mockReturnValue({
        accountId: vi.fn().mockReturnValue({
          call: vi.fn().mockRejectedValue(notFoundError),
        }),
      } as any);

      const verification = await verifyPayoutDestinationOnChain(mockPayoutAddress);
      expect(verification.status).toBe("unfunded");
      expect(verification.isFunded).toBe(false);
      expect(verification.exists).toBe(false);
      expect(verification.error).toContain("not funded on Stellar");
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

      const settlementCheck = result.checks.find((c) => c.id === "settlement-readiness");
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

      const settlementCheck = result.checks.find((c) => c.id === "settlement-readiness");
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

      const payoutCheck = result.checks.find((c) => c.id === "payout-destination");
      expect(payoutCheck?.status).toBe("fail");
      expect(payoutCheck?.message).toContain("Set up your payout address");
    });
  });
});
