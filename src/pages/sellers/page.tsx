import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Loader2,
  PackageSearch,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { PromptCard } from "@/pages/browse/PromptCard";
import { PromptModal } from "@/pages/browse/PromptModal";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { formatPriceLabel } from "@/lib/stellar/format";
import { shortenAddress } from "@/lib/utils";
import {
  getAllPrompts,
  type PromptRecord,
} from "@/lib/stellar/promptHashClient";
import { invalidateAllPromptQueries } from "@/hooks/useContractSync";

const isMarketplaceConfigured = Boolean(
  browserStellarConfig.promptHashContractId &&
  browserStellarConfig.simulationAccount &&
  browserStellarConfig.rpcUrl,
);

const normalizeSellerId = (sellerId = "") =>
  decodeURIComponent(sellerId).trim();
const sellerMatchesPrompt = (prompt: PromptRecord, sellerId: string) =>
  prompt.creator.toLowerCase() === sellerId.toLowerCase();
const sumBigInt = (values: bigint[]) =>
  values.reduce((total, value) => total + value, 0n);

export default function SellerPage() {
  const queryClient = useQueryClient();
  const { sellerId } = useParams<{ sellerId: string }>();
  const sellerAddress = normalizeSellerId(sellerId);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptRecord | null>(
    null,
  );

  const promptsQuery = useQuery({
    queryKey: ["seller-prompts", sellerAddress],
    queryFn: async () => {
      if (!isMarketplaceConfigured) return [];
      return getAllPrompts(browserStellarConfig);
    },
    enabled: Boolean(sellerAddress),
  });

  const sellerPrompts = useMemo(
    () =>
      (promptsQuery.data ?? []).filter(
        (prompt) => prompt.active && sellerMatchesPrompt(prompt, sellerAddress),
      ),
    [promptsQuery.data, sellerAddress],
  );

  const stats = useMemo(() => {
    const totalSales = sellerPrompts.reduce(
      (total, prompt) => total + prompt.salesCount,
      0,
    );
    const totalListedValue = sumBigInt(
      sellerPrompts.map((prompt) => prompt.priceStroops),
    );
    const categories = new Set(sellerPrompts.map((prompt) => prompt.category));
    return { totalSales, totalListedValue, categoryCount: categories.size };
  }, [sellerPrompts]);

  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-emerald-500/30">
      <Navigation />
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <Button
          asChild
          variant="ghost"
          className="mb-8 text-slate-300 hover:bg-white/5 hover:text-white"
        >
          <Link to="/browse">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to marketplace
          </Link>
        </Button>

        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-emerald-950/20 sm:p-8 lg:p-10">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="absolute -bottom-24 left-10 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="relative grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-emerald-200">
                <Sparkles className="h-3.5 w-3.5" /> Seller profile
              </div>
              <h1 className="max-w-3xl text-3xl font-black tracking-tight text-white sm:text-5xl">
                {sellerAddress
                  ? shortenAddress(sellerAddress)
                  : "Unknown seller"}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
                Browse active prompt licenses from this creator and review their
                marketplace activity before unlocking a prompt.
              </p>
              {sellerAddress && (
                <p className="mt-5 break-all rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 font-mono text-xs text-slate-300 sm:text-sm">
                  {sellerAddress}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
                <ShoppingBag className="mb-3 h-5 w-5 text-emerald-300" />
                <p className="text-2xl font-black">{sellerPrompts.length}</p>
                <p className="text-sm text-slate-400">Active prompts</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
                <BarChart3 className="mb-3 h-5 w-5 text-cyan-300" />
                <p className="text-2xl font-black">{stats.totalSales}</p>
                <p className="text-sm text-slate-400">Marketplace sales</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
                <BadgeCheck className="mb-3 h-5 w-5 text-amber-300" />
                <p className="text-2xl font-black">
                  {formatPriceLabel(stats.totalListedValue)}
                </p>
                <p className="text-sm text-slate-400">
                  Listed value · {stats.categoryCount} categories
                </p>
              </div>
            </div>
          </div>
        </section>

        {!isMarketplaceConfigured && (
          <div className="mt-8 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
            Contract config is missing, so seller listings cannot be loaded from
            the marketplace network yet.
          </div>
        )}

        <section className="mt-12">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-300">
            Active catalog
          </p>
          <h2 className="mb-6 mt-2 text-2xl font-bold sm:text-3xl">
            Prompts by this seller
          </h2>
          {promptsQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
              {[...Array(3)].map((_, index) => (
                <div
                  key={index}
                  className="h-[400px] animate-pulse rounded-3xl border border-white/5 bg-white/[0.02]"
                />
              ))}
            </div>
          ) : promptsQuery.isError ? (
            <div className="rounded-3xl border border-red-500/20 bg-red-500/5 p-10 text-center">
              <p className="font-semibold text-red-300">Seller sync failed</p>
              <p className="mt-2 text-sm text-slate-400">
                We could not load this seller's marketplace data.
              </p>
              <Button className="mt-5" onClick={() => promptsQuery.refetch()}>
                <Loader2 className="mr-2 h-4 w-4" /> Retry
              </Button>
            </div>
          ) : sellerPrompts.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-16 text-center">
              <PackageSearch className="mb-4 h-10 w-10 text-slate-500" />
              <h3 className="text-xl font-bold">No active prompts found</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
                This seller may not exist yet, may have no active listings, or
                their listings are unavailable with the current network config.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
              {sellerPrompts.map((prompt) => (
                <PromptCard
                  key={prompt.id.toString()}
                  prompt={prompt}
                  hasAccess={false}
                  openModal={setSelectedPrompt}
                  isSaved={false}
                  isSaving={false}
                  onToggleSave={() => undefined}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {selectedPrompt && (
        <PromptModal
          itemId={selectedPrompt.id.toString()}
          isOpen={Boolean(selectedPrompt)}
          onClose={() => setSelectedPrompt(null)}
          onRefresh={() => invalidateAllPromptQueries(queryClient)}
        />
      )}
      <Footer />
    </div>
  );
}
