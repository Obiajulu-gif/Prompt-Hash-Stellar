import { DollarSign, Clock, ArrowRight, Loader2, ChevronDown } from "lucide-react";
import { usePriceHistory, type PriceChangeEntry } from "@/hooks/usePriceHistory";
import { Skeleton } from "@/components/Skeleton";

interface PriceHistoryCardProps {
  onChainId: string;
  currentPriceStroops: bigint;
}

function formatXlm(price: number | null): string {
  if (price === null) return "—";
  return `${price.toFixed(2)} XLM`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PriceRow({
  entry,
  isCurrent,
}: {
  entry: PriceChangeEntry;
  isCurrent: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        isCurrent
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-white/[0.06] bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Clock className="h-3 w-3" />
          <span>{formatDate(entry.createdAt)}</span>
          {entry.ledgerSeq && (
            <span className="font-mono text-slate-500">
              ledger #{entry.ledgerSeq}
            </span>
          )}
        </div>
        {isCurrent && (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            Current
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <span className="text-sm text-slate-400">
          {formatXlm(entry.previousPrice)}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-slate-600" />
        <span
          className={`text-sm font-semibold ${
            isCurrent ? "text-emerald-300" : "text-white"
          }`}
        >
          {formatXlm(entry.newPrice)}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {entry.asset}
        </span>
      </div>
    </div>
  );
}

export function PriceHistoryCard({
  onChainId,
  currentPriceStroops,
}: PriceHistoryCardProps) {
  const { changes, isLoading, error, hasMore, loadMore } =
    usePriceHistory(onChainId);
  const currentPriceXlm = Number(currentPriceStroops) / 10_000_000;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          Price History
        </h3>
        <span className="ml-auto text-xs text-slate-500">
          {formatXlm(currentPriceXlm)} current
        </span>
      </div>

      {isLoading && changes.length === 0 ? (
        <div className="space-y-3" role="status" aria-live="polite">
          <span className="sr-only">Loading price history</span>
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg bg-white/[0.02]" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-rose-400">{error}</p>
      ) : changes.length === 0 ? (
        <p className="text-sm text-slate-500">
          No price changes recorded for this listing.
        </p>
      ) : (
        <div className="space-y-2">
          {changes.map((entry, idx) => (
            <PriceRow
              key={entry._id}
              entry={entry}
              isCurrent={
                idx === 0 && entry.newPrice === currentPriceXlm
              }
            />
          ))}

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-300 disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {isLoading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}