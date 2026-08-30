/**
 * Tests for usePayoutReadiness hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletContext, type WalletContextType } from "@/providers/WalletProvider";
import { usePayoutReadiness, usePayoutReadinessGate } from "@/hooks/usePayoutReadiness";
import type { CreatorProfile } from "@/lib/profiles/creatorProfile";

// Mock the validation module
vi.mock("@/lib/validation/payoutReadiness", () => ({
  checkCreatorPayoutReadiness: vi.fn(),
  shouldBlockPaidPublication: vi.fn(),
  getBlockingIssues: vi.fn(),
}));

// Mock the useCreatorProfile hook
vi.mock("@/hooks/useCreatorProfile", () => ({
  useCreatorProfile: vi.fn(),
}));

// Mock the useWalletBalance hook
vi.mock("@/hooks/useWalletBalance", () => ({
  useWalletBalance: vi.fn(),
}));

import { checkCreatorPayoutReadiness, shouldBlockPaidPublication, getBlockingIssues } from "@/lib/validation/payoutReadiness";
import { useCreatorProfile } from "@/hooks/useCreatorProfile";
import { useWalletBalance } from "@/hooks/useWalletBalance";

const mockCheckCreatorPayoutReadiness = vi.mocked(checkCreatorPayoutReadiness);
const mockShouldBlockPaidPublication = vi.mocked(shouldBlockPaidPublication);
const mockGetBlockingIssues = vi.mocked(getBlockingIssues);
const mockUseCreatorProfile = vi.mocked(useCreatorProfile);
const mockUseWalletBalance = vi.mocked(useWalletBalance);

function createWrapper(wallet: Partial<WalletContextType> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const defaultWallet: WalletContextType = {
    address: undefined,
    network: undefined,
    networkPassphrase: undefined,
    status: "idle",
    error: undefined,
    networkCompatibility: { compatible: true } as any,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
    ...wallet,
  };

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WalletContext value={defaultWallet}>
        {children}
      </WalletContext>
    </QueryClientProvider>
  );
}

describe("usePayoutReadiness", () => {
  const mockAddress = "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
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

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementations
    mockUseCreatorProfile.mockReturnValue({
      profile: mockProfile,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    mockUseWalletBalance.mockReturnValue({
      xlm: "5.0",
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return loading state when wallet is not connected", () => {
    const wrapper = createWrapper({ address: undefined });
    const { result } = renderHook(() => usePayoutReadiness(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.readiness).toBeNull();
    expect(result.current.isReady).toBe(false);
    expect(result.current.shouldBlock).toBe(true);
  });

  it("should return loading state when dependencies are loading", () => {
    mockUseCreatorProfile.mockReturnValue({
      profile: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    const wrapper = createWrapper({ address: mockAddress });
    const { result } = renderHook(() => usePayoutReadiness(), { wrapper });

    expect(result.current.isLoading).toBe(true);
  });

  it("should check readiness when all dependencies are loaded", async () => {
    const mockReadinessResult = {
      isReady: true,
      checks: [
        {
          id: "wallet-connection",
          name: "Wallet Connection",
          description: "Valid Stellar wallet must be connected",
          status: "pass" as const,
          message: "Wallet connected successfully",
        },
      ],
      blockers: [],
      warnings: [],
    };

    mockCheckCreatorPayoutReadiness.mockReturnValue(mockReadinessResult);
    mockShouldBlockPaidPublication.mockReturnValue(false);
    mockGetBlockingIssues.mockReturnValue([]);

    const wrapper = createWrapper({ address: mockAddress });
    const { result } = renderHook(() => usePayoutReadiness(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.readiness).toEqual(mockReadinessResult);
    expect(result.current.isReady).toBe(true);
    expect(result.current.shouldBlock).toBe(false);
    expect(result.current.blockingIssues).toEqual([]);
  });

  it("should handle readiness check failure", async () => {
    const mockReadinessResult = {
      isReady: false,
      checks: [
        {
          id: "creator-profile",
          name: "Creator Profile",
          description: "Complete profile builds buyer trust",
          status: "fail" as const,
          message: "Complete your creator profile",
        },
      ],
      blockers: ["Complete your creator profile"],
      warnings: [],
    };

    mockCheckCreatorPayoutReadiness.mockReturnValue(mockReadinessResult);
    mockShouldBlockPaidPublication.mockReturnValue(true);
    mockGetBlockingIssues.mockReturnValue(["Complete your creator profile"]);

    const wrapper = createWrapper({ address: mockAddress });
    const { result } = renderHook(() => usePayoutReadiness(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.readiness).toEqual(mockReadinessResult);
    expect(result.current.isReady).toBe(false);
    expect(result.current.shouldBlock).toBe(true);
    expect(result.current.blockingIssues).toEqual(["Complete your creator profile"]);
  });

  it("should handle validation errors gracefully", async () => {
    mockCheckCreatorPayoutReadiness.mockImplementation(() => {
      throw new Error("Validation error");
    });

    const wrapper = createWrapper({ address: mockAddress });
    const { result } = renderHook(() => usePayoutReadiness(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.readiness).toEqual({
      isReady: false,
      checks: [],
      blockers: ["Unable to verify payout readiness"],
      warnings: [],
    });
  });

  it("should refresh readiness when refreshReadiness is called", async () => {
    const mockReadinessResult = {
      isReady: true,
      checks: [],
      blockers: [],
      warnings: [],
    };

    mockCheckCreatorPayoutReadiness.mockReturnValue(mockReadinessResult);

    const wrapper = createWrapper({ address: mockAddress });
    const { result } = renderHook(() => usePayoutReadiness(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Clear previous calls
    mockCheckCreatorPayoutReadiness.mockClear();

    // Call refresh
    result.current.refreshReadiness();

    await waitFor(() => {
      expect(mockCheckCreatorPayoutReadiness).toHaveBeenCalledTimes(1);
    });
  });

  it("should update when wallet address changes", async () => {
    const wrapper = createWrapper({ address: mockAddress });
    const { result, rerender } = renderHook(() => usePayoutReadiness(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Change wrapper to different address
    const newAddress = "GDNEWADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    const newWrapper = createWrapper({ address: newAddress });
    
    rerender({ wrapper: newWrapper });

    await waitFor(() => {
      expect(mockCheckCreatorPayoutReadiness).toHaveBeenCalledWith(
        newAddress,
        expect.any(Object),
        expect.any(String)
      );
    });
  });
});

describe("usePayoutReadinessGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    mockUseCreatorProfile.mockReturnValue({
      profile: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    mockUseWalletBalance.mockReturnValue({
      xlm: "5.0",
      isLoading: false,
    });
  });

  it("should return simplified interface for gate checks", async () => {
    const mockReadinessResult = {
      isReady: false,
      checks: [],
      blockers: ["Setup incomplete"],
      warnings: [],
    };

    mockCheckCreatorPayoutReadiness.mockReturnValue(mockReadinessResult);
    mockShouldBlockPaidPublication.mockReturnValue(true);
    mockGetBlockingIssues.mockReturnValue(["Setup incomplete"]);

    const wrapper = createWrapper({ 
      address: "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890" 
    });
    const { result } = renderHook(() => usePayoutReadinessGate(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.shouldBlock).toBe(true);
    expect(result.current.blockingIssues).toEqual(["Setup incomplete"]);
  });

  it("should return not blocking when ready", async () => {
    const mockReadinessResult = {
      isReady: true,
      checks: [],
      blockers: [],
      warnings: [],
    };

    mockCheckCreatorPayoutReadiness.mockReturnValue(mockReadinessResult);
    mockShouldBlockPaidPublication.mockReturnValue(false);
    mockGetBlockingIssues.mockReturnValue([]);

    const wrapper = createWrapper({ 
      address: "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890" 
    });
    const { result } = renderHook(() => usePayoutReadinessGate(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.shouldBlock).toBe(false);
    expect(result.current.blockingIssues).toEqual([]);
  });
});