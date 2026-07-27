import { useQuery } from "@tanstack/react-query";
import { useWallet } from "./useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { getPromptsByCreator, getPromptsByBuyer } from "@/lib/stellar/promptHashClient";

export const useDashboard = () => {
  const { address } = useWallet();

  const createdQuery = useQuery({
    queryKey: ["created-prompts", address],
    queryFn: async () => {
      if (!address) return [];
      return getPromptsByCreator(browserStellarConfig, address);
    },
    enabled: Boolean(address),
    retry: 1,
  });

  const purchasedQuery = useQuery({
    queryKey: ["purchased-prompts", address],
    queryFn: async () => {
      if (!address) return [];
      return getPromptsByBuyer(browserStellarConfig, address);
    },
    enabled: Boolean(address),
    retry: 1,
  });

  const isLoading = createdQuery.isLoading || purchasedQuery.isLoading;
  const isError = createdQuery.isError || purchasedQuery.isError;
  const isPartialError = createdQuery.isError !== purchasedQuery.isError;

  return {
    address,
    created: {
      data: createdQuery.data ?? [],
      isLoading: createdQuery.isLoading,
      isError: createdQuery.isError,
      error: createdQuery.error,
    },
    purchased: {
      data: purchasedQuery.data ?? [],
      isLoading: purchasedQuery.isLoading,
      isError: purchasedQuery.isError,
      error: purchasedQuery.error,
    },
    isLoading,
    isError,
    isPartialError,
    refresh: async () => {
      await Promise.all([
        createdQuery.refetch(),
        purchasedQuery.refetch(),
      ]);
    },
  };
};
