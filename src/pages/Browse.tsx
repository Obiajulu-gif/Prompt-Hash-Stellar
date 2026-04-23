import React, { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAsyncTransaction } from "../components/useAsyncTransaction";
import { Skeleton } from "../components/Skeleton";

// Assuming a Stellar contract call or SDK usage
const purchasePrompt = async (itemId: string) => {
  // Simulating a network call for the marketplace purchase
  return new Promise((resolve) => setTimeout(resolve, 2000));
};

export default function Browse() {
  const queryClient = useQueryClient();
  const [optimisticPurchases, setOptimisticPurchases] = useState<Set<string>>(new Set());

  // Mock fetching marketplace items
  const { data: items, isLoading: isFetching } = useQuery({
    queryKey: ["marketplace-items"],
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return [
        { id: "1", name: "AI Prompt #1", price: "10 XLM" },
        { id: "2", name: "AI Prompt #2", price: "20 XLM" },
        { id: "3", name: "AI Prompt #3", price: "50 XLM" },
      ];
    },
  });

  const { execute, isLoading: isPurchasing } = useAsyncTransaction(
    async (itemId: string) => {
      await purchasePrompt(itemId);
    },
    {
      pendingMessage: "Processing purchase on the Stellar network...",
      successMessage: "Purchase complete! Prompt unlocked.",
      onOptimistic: (itemId) => {
        setOptimisticPurchases((prev) => new Set(prev).add(itemId));
      },
      onSuccess: () => {
        // Invalidate to refresh the account balance and purchased status
        queryClient.invalidateQueries({ queryKey: ["account-balance"] });
        queryClient.invalidateQueries({ queryKey: ["marketplace-items"] });
      },
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
                <button
                  onClick={() => execute(item.id)}
                  disabled={isProcessing}
                  className="mt-4 w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 disabled:cursor-not-allowed text-white font-bold rounded-md transition-colors"
                >
                  {isProcessing ? "Processing..." : "Purchase"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}