import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ExternalLink,
  Loader2,
  Receipt,
  ShoppingBag,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  fetchPurchaseTransactions,
  type PurchaseTransaction,
} from "@/lib/prompts/transactions";
import { stellarExpertTxUrl } from "@/lib/stellar/explorer";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

function formatAmount(amount: number | null): string {
  if (amount === null) return "—";
  return `${amount.toLocaleString(undefined, {
    maximumFractionDigits: 7,
  })} XLM`;
}

function shortHash(hash: string): string {
  if (!hash) return "Pending";
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}

function TransactionRow({ tx }: { tx: PurchaseTransaction }) {
  return (
    <tr className="border-t border-white/[0.06] transition-colors hover:bg-white/[0.02]">
      <td className="px-4 py-4 align-middle">
        <p className="font-medium text-white">{tx.promptTitle}</p>
        <p className="font-mono text-xs text-slate-500">#{tx.promptId}</p>
      </td>
      <td className="whitespace-nowrap px-4 py-4 align-middle text-slate-300">
        {formatDate(tx.createdAt)}
      </td>
      <td className="whitespace-nowrap px-4 py-4 align-middle font-semibold tabular-nums text-white">
        {formatAmount(tx.amountXlm)}
      </td>
      <td className="px-4 py-4 align-middle">
        {tx.txHash ? (
          <a
            href={stellarExpertTxUrl(tx.txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-cyan-300 transition-colors hover:text-cyan-200"
            aria-label={`View transaction ${tx.txHash} on Stellar Expert`}
          >
            {shortHash(tx.txHash)}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="font-mono text-xs text-slate-600">Pending</span>
        )}
      </td>
    </tr>
  );
}

/**
 * Renders the connected wallet's prompt purchase / licensing history as a
 * table, with each row linking its transaction hash to a Stellar block
 * explorer. Handles loading, error, and empty states.
 */
export function TransactionHistory({ walletAddress }: { walletAddress: string }) {
  const {
    data: transactions = [],
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["purchase-transactions", walletAddress],
    queryFn: () => fetchPurchaseTransactions(walletAddress),
    enabled: Boolean(walletAddress),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-8 text-sm text-slate-300">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-cyan-200" />
        Loading your transaction history...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="grid min-h-56 place-items-center rounded-xl border border-rose-300/20 bg-rose-400/[0.06] p-8 text-center">
        <div className="max-w-sm">
          <h3 className="text-lg font-semibold text-white">
            Couldn&apos;t load transactions
          </h3>
          <p className="mt-2 text-sm leading-6 text-rose-100/80">
            {error instanceof Error
              ? error.message
              : "Something went wrong while fetching your history."}
          </p>
          <Button
            onClick={() => void refetch()}
            disabled={isRefetching}
            className="mt-5 h-10 bg-rose-300 px-5 text-slate-950 hover:bg-rose-200"
          >
            {isRefetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
        <div className="max-w-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-200/10 text-cyan-100">
            <Receipt className="h-8 w-8" />
          </div>
          <h3 className="mt-5 text-xl font-semibold text-white">
            No transactions yet
          </h3>
          <p className="mt-3 text-sm leading-7 text-slate-400">
            Once this wallet purchases or licenses a prompt, every payment shows
            up here with its amount and a link to the Stellar block explorer.
          </p>
          <Button
            asChild
            className="mt-6 h-10 bg-cyan-200 px-6 text-slate-950 hover:bg-cyan-100"
          >
            <Link to="/browse">
              <ShoppingBag className="h-4 w-4" />
              Browse marketplace
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0f1419]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <p className="text-sm font-medium text-slate-300">
          {transactions.length} transaction
          {transactions.length === 1 ? "" : "s"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          disabled={isRefetching}
          className="h-8 text-slate-400 hover:text-white"
        >
          {isRefetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.14em] text-slate-500">
              <th scope="col" className="px-4 py-3 font-medium">
                Prompt
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Date
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Amount
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Transaction
              </th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
