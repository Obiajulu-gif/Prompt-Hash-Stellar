import React, { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAsyncTransaction } from "../components/useAsyncTransaction";
import { Skeleton } from "../components/Skeleton";

export interface MarketplaceItem {
  id: string;
  name: string;
  price: string;
  isSold: boolean;
}

// Simulating a Stellar Soroban contract call
const buyAssetContractCall = async (itemId: string) => {
  // E.g., await contract.call('buy_asset', { id: itemId });
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // Simulate a random failure for demonstration of the Retry recovery flow
      if (Math.random() < 0.2) return reject(new Error("op_underfunded"));
      resolve(true);
    }, 2000);
  });
};

export default function Marketplace() {
  const queryClient = useQueryClient();
  const [optimisticPurchases, setOptimisticPurchases] = useState<Set<string>>(new Set());

  // 1. Fetching marketplace items
  const { data: items, isLoading: isFetching } = useQuery({
    queryKey: ["marketplace-items"],
    queryFn: async (): Promise<MarketplaceItem[]> => {
      await new Promise((r) => setTimeout(r, 1000));
      return [
        { id: "1", name: "AI Prompt #1", price: "10 XLM", isSold: false },
        { id: "2", name: "AI Prompt #2", price: "20 XLM", isSold: false },
        { id: "3", name: "AI Prompt #3", price: "50 XLM", isSold: true },
      ];
    },
  });

  // 2. Wrap purchase flow in useAsyncTransaction
  const { execute, isLoading: isPurchasing } = useAsyncTransaction(
    async (itemId: string) => {
      await buyAssetContractCall(itemId);
    },
    {
      pendingMessage: "Processing purchase on the Stellar network...",
      successMessage: "Purchase complete! Item unlocked.",
      // Optimistic UI update: disable button and show "Purchasing..."
      onOptimistic: (itemId) => {
        setOptimisticPurchases((prev) => new Set(prev).add(itemId));
      },
      // Query Invalidation: trigger re-fetch of balance and items on success
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["account-balance"] });
        queryClient.invalidateQueries({ queryKey: ["marketplace-items"] });
      },
      // Clean up optimistic state
      onSettled: () => {
        setOptimisticPurchases(new Set());
      },
    }
  );

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-white">Marketplace</h1>
      
      {isFetching ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items?.map((item) => {
            const isProcessing = optimisticPurchases.has(item.id) || (isPurchasing && optimisticPurchases.has(item.id));
            return (
              <div key={item.id} className="p-4 border border-white/10 rounded-xl bg-slate-900 shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white">{item.name}</h3>
                  <p className="text-slate-400">{item.price}</p>
                </div>
                <div className="mt-4">
                  {item.isSold ? (
                    <span className="inline-block w-full text-center px-4 py-2 text-emerald-400 font-bold bg-emerald-950/30 rounded-md border border-emerald-900/50">
                      Owned
                    </span>
                  ) : (
                    <button
                      onClick={() => execute(item.id)}
                      disabled={isProcessing}
                      className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 disabled:cursor-not-allowed text-white font-bold rounded-md transition-colors"
                    >
                      {isProcessing ? "Purchasing..." : "Buy"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}