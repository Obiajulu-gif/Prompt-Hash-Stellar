import { useInfiniteQuery } from "@tanstack/react-query";
import { getAllPromptsPaginated } from "@/lib/stellar/promptHashClient";
import type { PromptHashConfig, PromptRecord } from "@/lib/stellar/promptHashClient";

/** Number of prompts requested from the contract per paginated page. */
export const CATALOG_PAGE_SIZE = 50;

/**
 * Short client-side cache TTL. Rapid re-renders / navigations away and back to
 * the browse page should not re-fetch the same pages redundantly, but the
 * catalog can change (new listings, price edits) so we don't cache forever.
 */
export const CATALOG_CACHE_STALE_MS = 30_000;

export type CatalogPage = {
  prompts: PromptRecord[];
  nextCursor: string | null;
};

/**
 * Loads the marketplace catalog one bounded page at a time using the
 * contract's `get_all_prompts_paginated` entry point. `useInfiniteQuery`
 * accumulates each fetched page in `data.pages` (load-more *appends* rather
 * than replacing), which is exactly the behavior the browse grid relies on.
 */
export function useCatalogPages(config: PromptHashConfig | null) {
  return useInfiniteQuery<CatalogPage>({
    queryKey: ["marketplace-prompts", config?.promptHashContractId],
    enabled: Boolean(config),
    queryFn: ({ pageParam }) =>
      getAllPromptsPaginated(config as PromptHashConfig, pageParam ?? null, CATALOG_PAGE_SIZE),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: CATALOG_CACHE_STALE_MS,
  });
}
