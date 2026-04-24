import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSubscription } from "./useSubscription";
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
 * retries silently on the next interval. Post-TX invalidation has already
 * run synchronously from chain confirmation, so the submitter's state
 * never depends on the background poll succeeding.
 *
 * Query-key → invalidation mapping:
 *   Any contract event → ["marketplace-prompts"]  (browse grid, prices, active flag)
 *   Any contract event → ["created-prompts"]       (creator inventory + sales count)
 *   Any contract event → ["purchased-prompts"]     (buyer's license list)
 *   Any contract event → ["prompt-access"]         (per-prompt access checks)
 */

const POLL_INTERVAL_MS = 10_000;

export function invalidateAllPromptQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["marketplace-prompts"] }),
    queryClient.invalidateQueries({ queryKey: ["created-prompts"] }),
    queryClient.invalidateQueries({ queryKey: ["purchased-prompts"] }),
    queryClient.invalidateQueries({ queryKey: ["prompt-access"] }),
  ]);
}

export function useContractSync() {
  const queryClient = useQueryClient();

  const handleEvent = useCallback(() => {
    void invalidateAllPromptQueries(queryClient);
  }, [queryClient]);

  // topic is undefined → subscribe to all events from this contract
  useSubscription(
    browserStellarConfig.promptHashContractId,
    undefined,
    handleEvent,
    POLL_INTERVAL_MS,
  );
}
