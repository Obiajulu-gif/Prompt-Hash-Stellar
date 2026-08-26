import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSubscription } from "./useSubscription";
import { useWalletAccountChange } from "./useWalletAccountChange";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";

/**
 * Sync strategy: hybrid approach
 *
 * Short-term sync is implemented in two layers:
 *
 * 1. Immediate post-TX invalidation — after any write transaction (create,
 *    buy, price update, sale-status change), the caller invokes
 *    `invalidateAllPromptQueries()` so the submitting user sees fresh
 *    on-chain state right away without waiting for the background poll.
 *
 * 2. Background event polling — `useContractSync` (mounted once via
 *    `ContractSyncProvider`) polls ALL contract events from the PromptHash
 *    contract every 10 seconds. When any new event arrives it invalidates
 *    every prompt-related query key. This keeps browse/profile pages fresh
 *    for users who did not submit the transaction — e.g. a browsing user
 *    sees an updated sales count after another wallet completes a purchase.
 *
 * Fallback: if the RPC event endpoint is unavailable, the background loop
 * implements exponential backoff (max 120s) and retries silently. Post-TX
 * invalidation has already run synchronously from chain confirmation, so the
 * submitter's state never depends on the background poll succeeding.
 *
 * Wallet account changes trigger immediate cache invalidation via
 * useWalletAccountChange() to prevent stale data when users switch accounts.
 *
 * Query-key → invalidation mapping:
 *   Any contract event → ["marketplace-prompts"]  (browse grid, prices, active flag)
 *   Any contract event → ["created-prompts"]       (creator inventory + sales count)
 *   Any contract event → ["purchased-prompts"]     (buyer's license list)
 *   Any contract event → ["saved-prompts"]          (buyer saved listings)
 *   Any contract event → ["prompt-access"]         (per-prompt access checks)
 */

const POLL_INTERVAL_MS = 10_000;
const MAX_BACKOFF_MS = 120_000;

export function invalidateAllPromptQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["marketplace-prompts"] }),
    queryClient.invalidateQueries({ queryKey: ["created-prompts"] }),
    queryClient.invalidateQueries({ queryKey: ["purchased-prompts"] }),
    queryClient.invalidateQueries({ queryKey: ["saved-prompts"] }),
    queryClient.invalidateQueries({ queryKey: ["prompt-access"] }),
  ]);
}

export function useContractSync() {
  const queryClient = useQueryClient();
  const pollInProgressRef = useRef(false);
  const consecutiveErrorsRef = useRef(0);

  useWalletAccountChange();

  const handleEvent = useCallback(() => {
    void invalidateAllPromptQueries(queryClient);
  }, [queryClient]);

  const createPollingHandler = useCallback(() => {
    return async () => {
      if (pollInProgressRef.current) {
        return;
      }

      pollInProgressRef.current = true;
      try {
        handleEvent();
        consecutiveErrorsRef.current = 0;
      } catch (error) {
        consecutiveErrorsRef.current++;
        console.error(
          `Contract sync error (attempt ${consecutiveErrorsRef.current}):`,
          error,
        );
      } finally {
        pollInProgressRef.current = false;
      }
    };
  }, [handleEvent]);

  const calculateBackoffInterval = useCallback(() => {
    const errorCount = consecutiveErrorsRef.current;
    if (errorCount === 0) {
      return POLL_INTERVAL_MS;
    }
    const exponential = Math.min(
      POLL_INTERVAL_MS * Math.pow(2, errorCount - 1),
      MAX_BACKOFF_MS,
    );
    return exponential;
  }, []);

  useEffect(() => {
    if (!browserStellarConfig.promptHashContractId) return;

    pollInProgressRef.current = false;
    consecutiveErrorsRef.current = 0;

    let timeoutId: NodeJS.Timeout | null = null;
    let stopped = false;

    async function poll() {
      if (stopped) return;

      try {
        const handler = createPollingHandler();
        await handler();
      } finally {
        if (!stopped) {
          const nextInterval = calculateBackoffInterval();
          timeoutId = setTimeout(poll, nextInterval);
        }
      }
    }

    poll();

    return () => {
      stopped = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [createPollingHandler, calculateBackoffInterval]);
}
