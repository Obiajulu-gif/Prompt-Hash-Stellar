/**
 * React hook for managing payout readiness state
 */

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "./useWallet";
import { useWalletBalance } from "./useWalletBalance";
import { useCreatorProfile } from "./useCreatorProfile";
import {
  PayoutReadinessResult,
  checkCreatorPayoutReadiness,
  shouldBlockPaidPublication,
  getBlockingIssues,
} from "../lib/validation/payoutReadiness";

export interface UsePayoutReadinessResult {
  readiness: PayoutReadinessResult | null;
  isLoading: boolean;
  isReady: boolean;
  shouldBlock: boolean;
  blockingIssues: string[];
  refreshReadiness: () => void;
}

/**
 * Hook to check and manage payout readiness state
 */
export function usePayoutReadiness(): UsePayoutReadinessResult {
  const { address } = useWallet();
  const { xlm, isLoading: isBalanceLoading } = useWalletBalance();
  const { profile, isLoading: isProfileLoading } = useCreatorProfile(address);

  const [readiness, setReadiness] = useState<PayoutReadinessResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkReadiness = useCallback(async () => {
    if (!address) {
      setReadiness(null);
      setIsLoading(false);
      return;
    }

    // Wait for dependent data to load
    if (isBalanceLoading || isProfileLoading) {
      return;
    }

    setIsLoading(true);

    try {
      const result = checkCreatorPayoutReadiness(address, profile, xlm);
      setReadiness(result);
    } catch (error) {
      console.error("Error checking payout readiness:", error);
      // Create a fallback readiness result
      setReadiness({
        isReady: false,
        checks: [],
        blockers: ["Unable to verify payout readiness"],
        warnings: [],
      });
    } finally {
      setIsLoading(false);
    }
  }, [address, profile, xlm, isBalanceLoading, isProfileLoading]);

  // Check readiness when dependencies change
  useEffect(() => {
    checkReadiness();
  }, [checkReadiness]);

  const refreshReadiness = useCallback(() => {
    checkReadiness();
  }, [checkReadiness]);

  return {
    readiness,
    isLoading,
    isReady: readiness?.isReady ?? false,
    shouldBlock: readiness ? shouldBlockPaidPublication(readiness) : true,
    blockingIssues: readiness ? getBlockingIssues(readiness) : [],
    refreshReadiness,
  };
}

/**
 * Hook specifically for checking if paid publication should be blocked
 */
export function usePayoutReadinessGate(): {
  shouldBlock: boolean;
  isLoading: boolean;
  blockingIssues: string[];
} {
  const { shouldBlock, isLoading, blockingIssues } = usePayoutReadiness();

  return {
    shouldBlock,
    isLoading,
    blockingIssues,
  };
}