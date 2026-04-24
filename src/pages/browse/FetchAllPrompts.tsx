import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  const [selectedPrompt, setSelectedPrompt] = useState<PromptRecord | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const promptsQuery = useQuery({
    queryKey: ["marketplace-prompts"],
    queryFn: async () => {
      if (!isMarketplaceConfigured) {
        return [];
      }

      return getAllPrompts(browserStellarConfig);
    },
  });

  const accessQueries = useQueries({
    queries: (address ? promptsQuery.data ?? [] : []).map((prompt) => ({
      queryKey: ["prompt-access", address, prompt.id.toString()],
      queryFn: async () => hasAccess(browserStellarConfig, address!, prompt.id),
      staleTime: 15_000,
    })),
  });

  const accessMap = useMemo(() => {
    return new Map(
      (promptsQuery.data ?? []).map((prompt, index) => [
        prompt.id.toString(),
        address ? accessQueries[index]?.data ?? prompt.creator === address : false,
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
        prompt.previewText.toLowerCase().includes(normalizedSearch) ||
        prompt.category.toLowerCase().includes(normalizedSearch);
      const matchesPrice =
        promptPrice >= priceRange[0] && promptPrice <= priceRange[1];

      return prompt.active && matchesCategory && matchesSearch && matchesPrice;
    });

    switch (sortBy) {
      case "price-low":
        return [...prompts].sort((left, right) =>
          left.priceStroops < right.priceStroops ? -1 : 1,
        );
      case "price-high":
        return [...prompts].sort((left, right) =>
          left.priceStroops > right.priceStroops ? -1 : 1,
        );
      case "sales":
        return [...prompts].sort((left, right) => right.salesCount - left.salesCount);
      default:
        return [...prompts].sort((left, right) => Number(right.id - left.id));
    }
  }, [priceRange, promptsQuery.data, searchQuery, selectedCategory, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredPrompts.length / ITEMS_PER_PAGE));
  const currentPrompts = filteredPrompts.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const refreshQueries = () => invalidateAllPromptQueries(queryClient);

  useEffect(() => {
    setCurrentPage(1);
  }, [priceRange, searchQuery, selectedCategory, sortBy]);

  if (promptsQuery.isLoading) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-slate-200">
        Loading live prompts from Stellar testnet...
      </div>
    );
  }

  if (promptsQuery.isError) {
    return (
      <div className="rounded-3xl border border-red-400/20 bg-red-500/10 p-6 text-sm text-red-200">
        {promptsQuery.error instanceof Error
          ? promptsQuery.error.message
          : "Failed to load live marketplace prompts."}
      </div>
    );
  }

  return (
    <>
      {!isMarketplaceConfigured ? (
        <div className="mb-6 rounded-3xl border border-amber-400/20 bg-amber-500/10 p-5 text-sm text-amber-100">
          Add `PUBLIC_PROMPT_HASH_CONTRACT_ID` and `PUBLIC_STELLAR_SIMULATION_ACCOUNT`
          to load live marketplace listings from Stellar testnet.
        </div>
      ) : null}

      {filteredPrompts.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-10 text-center text-slate-300">
          No live prompts match the current filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {currentPrompts.map((prompt) => (
            <PromptCard
              key={prompt.id.toString()}
              prompt={prompt}
              hasAccess={accessMap.get(prompt.id.toString()) ?? false}
              openModal={setSelectedPrompt}
            />
          ))}
        </div>
      )}

      {filteredPrompts.length > ITEMS_PER_PAGE ? (
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button
            variant="outline"
            className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Previous
          </Button>
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100">
            Page {currentPage} of {totalPages}
          </div>
          <Button
            variant="outline"
            className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={currentPage === totalPages}
          >
            Next
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      ) : null}

      {selectedPrompt ? (
        <PromptModal
          prompt={selectedPrompt}
          initialHasAccess={accessMap.get(selectedPrompt.id.toString()) ?? false}
          closeModal={() => setSelectedPrompt(null)}
          onRefresh={refreshQueries}
        />
      ) : null}
    </>
  );
};

export default FetchAllPrompts;
