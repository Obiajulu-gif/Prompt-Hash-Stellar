import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAsyncTransaction } from "../components/useAsyncTransaction";
import { Skeleton } from "../components/Skeleton";

// 1. Mock: Fetching draft metadata/validation before listing
const fetchDraftMetadata = async () => {
  return new Promise<{ name: string; price: string; description: string }>((resolve) => {
    setTimeout(() => {
      resolve({ 
        name: "AI Prompt: Senior Developer Assistant", 
        price: "150",
        description: "A comprehensive persona prompt for advanced code reviews."
      });
    }, 1500);
  });
};

// 2. Mock: Stellar Soroban contract call for listing the asset
const listAssetContractCall = async (data: { name: string; price: string; description: string }) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // Simulate a random failure (like 'op_not_authorized' or 'tx_bad_auth')
      // The useAsyncTransaction hook will automatically catch this, translate it, and render the StatusBanner.
      if (Math.random() < 0.2) reject(new Error("op_not_authorized"));
      resolve(true);
    }, 2500);
  });
};

export default function Sell() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ name: "", price: "", description: "" });

  // Fetch initial data (e.g., from local storage, IPFS, or an API)
  const { data: draftData, isLoading: isFetchingDraft } = useQuery({
    queryKey: ["draft-metadata"],
    queryFn: fetchDraftMetadata,
  });

  // Populate form once draft data loads
  useEffect(() => {
    if (draftData) {
      setFormData(draftData);
    }
  }, [draftData]);

  // 3. Wrap the Stellar transaction logic
  const { execute, isLoading: isTransacting } = useAsyncTransaction(
    async (listingData: typeof formData) => {
      await listAssetContractCall(listingData);
    },
    {
      pendingMessage: "Processing listing on the Stellar network...",
      successMessage: "Asset listed successfully! Redirecting...",
      
      // Query Invalidation / Redirection
      onSuccess: () => {
        // Add a short delay so the user can see the "Success" StatusBanner before unmounting
        setTimeout(() => {
          navigate("/dashboard");
        }, 1500);
      },
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    execute(formData);
  };

  const isFormDisabled = isTransacting;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-white">List a New Prompt</h1>

      <form onSubmit={handleSubmit} className="space-y-6 bg-slate-900 p-6 rounded-xl border border-white/10 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Prompt Name</label>
          {isFetchingDraft ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <input
              type="text"
              required
              className="w-full bg-[#070602] border border-white/10 rounded-md p-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 transition-all"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={isFormDisabled}
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Price (XLM)</label>
          {isFetchingDraft ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <input
              type="number"
              required
              min="1"
              step="0.1"
              className="w-full bg-[#070602] border border-white/10 rounded-md p-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 transition-all"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              disabled={isFormDisabled}
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
          {isFetchingDraft ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <textarea
              required
              rows={3}
              className="w-full bg-[#070602] border border-white/10 rounded-md p-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 transition-all"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              disabled={isFormDisabled}
            />
          )}
        </div>

        <button
          type="submit"
          disabled={isFormDisabled || isFetchingDraft}
          className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 disabled:cursor-not-allowed text-white font-bold rounded-md transition-colors shadow-lg"
        >
          {isTransacting ? "Processing Listing..." : "List Asset"}
        </button>
      </form>
    </div>
  );
}