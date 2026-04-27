import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useQueries, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  PackageSearch,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import {
  getAllPrompts,
  hasAccess,
  type PromptRecord,
} from "@/lib/stellar/promptHashClient";
import { stroopsToXlmString } from "@/lib/stellar/format";
import { invalidateAllPromptQueries } from "@/hooks/useContractSync";
import { PromptCard } from "./PromptCard";
import { PromptModal } from "./PromptModal";

const ITEMS_PER_PAGE = 9;
const ENABLE_INFINITE_SCROLL = true;

const isMarketplaceConfigured = Boolean(
  browserStellarConfig.promptHashContractId &&
    browserStellarConfig.simulationAccount &&
    browserStellarConfig.rpcUrl,
);

const parseXlmNumber = (value: bigint) => Number(stroopsToXlmString(value));

export interface FetchAllPromptsProps {
  selectedCategory: string;
  priceRange: number[];
  searchQuery: string;
  sortBy: string;
}

const FetchAllPrompts = ({
  selectedCategory,
  priceRange,
  searchQuery,
  sortBy,
}: FetchAllPromptsProps) => {
  const queryClient = useQueryClient();
  const { address } = useWallet();
  const [selectedPrompt, setSelectedPrompt] = useState<PromptRecord | null>(
    null,
  );
  const [currentPage, setCurrentPage] = useState(1);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const promptsQuery = useQuery({
    queryKey: ["marketplace-prompts"],
    queryFn: async () => {
      if (!isMarketplaceConfigured) return [];
      return getAllPrompts(browserStellarConfig);
    },
  });

  // Infinite scroll observer
  useEffect(() => {
    if (!ENABLE_INFINITE_SCROLL || !loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && currentPage < totalPages) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1, rootMargin: "100px" }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [currentPage]);

  const accessQueries = useQueries({
    queries: (address ? (promptsQuery.data ?? []) : []).map((prompt) => ({
      queryKey: ["prompt-access", address, prompt.id.toString()],
      queryFn: async () =>
        hasAccess(browserStellarConfig, address!, prompt.id.toString()),
      staleTime: 15_000,
    })),
  });

  const accessMap = useMemo(() => {
    return new Map(
      (promptsQuery.data ?? []).map((prompt, index) => [
        prompt.id.toString(),
        address
          ? (accessQueries[index]?.data ?? prompt.creator === address)
          : false,
      ]),
    );
  }, [accessQueries, address, promptsQuery.data]);

  const filteredPrompts = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const prompts = (promptsQuery.data ?? []).filter((prompt) => {
      const promptPrice = parseXlmNumber(prompt.priceStroops);
      const matchesCategory =
        !selectedCategory || prompt.category === selectedCategory;
      const matchesSearch =
        !normalizedSearch ||
        prompt.title.toLowerCase().includes(normalizedSearch) ||
        prompt.category.toLowerCase().includes(normalizedSearch);
      const matchesPrice =
        promptPrice >= priceRange[0] && promptPrice <= priceRange[1];

      return prompt.active && matchesCategory && matchesSearch && matchesPrice;
    });

    switch (sortBy) {
      case "price-low":
        return [...prompts].sort((a, b) =>
          a.priceStroops < b.priceStroops ? -1 : 1,
        );
      case "price-high":
        return [...prompts].sort((a, b) =>
          a.priceStroops > b.priceStroops ? -1 : 1,
        );
      case "sales":
        return [...prompts].sort((a, b) => b.salesCount - a.salesCount);
      default:
        return [...prompts].sort((a, b) => Number(b.id - a.id));
    }
  }, [priceRange, promptsQuery.data, searchQuery, selectedCategory, sortBy]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredPrompts.length / ITEMS_PER_PAGE),
  );
  
  // For infinite scroll, show all items up to current page
  const currentPrompts = ENABLE_INFINITE_SCROLL
    ? filteredPrompts.slice(0, currentPage * ITEMS_PER_PAGE)
    : filteredPrompts.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE,
      );

  useEffect(() => {
    setCurrentPage(1);
  }, [priceRange, searchQuery, selectedCategory, sortBy]);

  if (promptsQuery.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-[400px] rounded-3xl border border-white/5 bg-white/[0.02] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (promptsQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center p-12 rounded-3xl border border-red-500/20 bg-red-500/5 text-center">
        <p className="text-red-400 font-medium mb-2">Sync Error</p>
        <p className="text-sm text-slate-400">
          {promptsQuery.error instanceof Error
            ? promptsQuery.error.message
            : "Stellar network connection timed out."}
        </p>
        <Button
          variant="link"
          className="mt-4 text-emerald-400"
          onClick={() => promptsQuery.refetch()}
        >
          Try Reconnecting
        </Button>
      </div>
    );
  }

  return (
    <>
      {!isMarketplaceConfigured && (
        <div className="mb-8 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm flex gap-3 items-center">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Contract config missing. Connect a network to view live listings.
        </div>
      )}

      {filteredPrompts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <div className="p-4 rounded-full bg-slate-900 border border-white/5">
            <PackageSearch className="h-8 w-8 text-slate-500" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">No prompts found</h3>
            <p className="text-slate-500 max-w-[280px]">
              Try adjusting your filters or search terms to find what you're
              looking for.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
            {currentPrompts.map((prompt) => (
              <PromptCard
                key={prompt.id.toString()}
                prompt={prompt}
                hasAccess={accessMap.get(prompt.id.toString()) ?? false}
                openModal={setSelectedPrompt}
              />
            ))}
          </div>

          {/* Infinite Scroll Trigger */}
          {ENABLE_INFINITE_SCROLL && currentPage < totalPages && (
            <div
              ref={loadMoreRef}
              className="mt-12 flex items-center justify-center py-8"
            >
              <div className="flex items-center gap-3 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading more prompts...</span>
              </div>
            </div>
          )}

          {/* Show count indicator for infinite scroll */}
          {ENABLE_INFINITE_SCROLL && filteredPrompts.length > ITEMS_PER_PAGE && (
            <div className="mt-8 text-center">
              <p className="text-sm text-slate-500">
                Showing <span className="text-white font-semibold">{currentPrompts.length}</span> of{" "}
                <span className="text-white font-semibold">{filteredPrompts.length}</span> prompts
              </p>
            </div>
          )}
        </>
      )}

      {/* Traditional Pagination (fallback when infinite scroll disabled) */}
      {!ENABLE_INFINITE_SCROLL && filteredPrompts.length > ITEMS_PER_PAGE && (
        <div className="mt-16 flex items-center justify-center gap-6">
          <Button
            variant="ghost"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="text-slate-400 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5 mr-2" /> Previous
          </Button>
          <span className="text-sm font-medium text-slate-500 uppercase tracking-widest">
            Page <span className="text-white">{currentPage}</span> /{" "}
            {totalPages}
          </span>
          <Button
            variant="ghost"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="text-slate-400 hover:text-white"
          >
            Next <ChevronRight className="h-5 w-5 ml-2" />
          </Button>
        </div>
      )}

      {selectedPrompt && (
        <PromptModal
          itemId={selectedPrompt.id.toString()}
          isOpen={!!selectedPrompt}
          onClose={() => setSelectedPrompt(null)}
          onRefresh={() => invalidateAllPromptQueries(queryClient)}
        />
      )}
    </>
  );
};

export default FetchAllPrompts;
