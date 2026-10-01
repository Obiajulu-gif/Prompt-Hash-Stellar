import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Download, DollarSign, ArrowUpRight, ArrowDownRight } from "lucide-react";

export interface LedgerSummaryData {
  summary: {
    grossSales: number;
    platformFees: number;
    refunds: number;
    adjustments: number;
    payouts: number;
    netBalance: number;
    entryCount: number;
  };
  reconciliation: {
    balanced: boolean;
    status: "balanced" | "mismatch" | "pending_settlement";
    calculatedNetBalance: number;
    stellarConfirmedBalance: number;
    driftAmount: number;
    unsettledEntriesCount: number;
    remediationNotes?: string;
  };
  recentEntries: Array<{
    id: string;
    entryType: string;
    promptId?: string;
    amount: number;
    currency: string;
    stellarTxRef?: string;
    referenceId: string;
    description: string;
    createdAt: string;
  }>;
}

interface PayoutLedgerSummaryProps {
  walletAddress: string;
  isAdmin?: boolean;
}

export const PayoutLedgerSummary: React.FC<PayoutLedgerSummaryProps> = ({
  walletAddress,
  isAdmin = false,
}) => {
  const [data, setData] = useState<LedgerSummaryData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLedgerData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payouts/creator/${walletAddress}/ledger`);
      if (!res.ok) {
        throw new Error(`Failed to fetch payout ledger (status ${res.status})`);
      }
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        throw new Error(json.error || "Unknown error");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load payout ledger.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (walletAddress) {
      void fetchLedgerData();
    }
  }, [walletAddress]);

  if (loading) {
    return (
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 animate-pulse flex items-center justify-center space-x-2">
        <RefreshCw className="w-5 h-5 animate-spin text-purple-400" />
        <span>Loading payout ledger and settlement state...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-red-950/40 border border-red-800/50 rounded-xl text-red-200">
        <div className="flex items-center space-x-2 font-semibold">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <span>Payout Ledger Unavailable</span>
        </div>
        <p className="mt-2 text-sm text-red-300">{error || "No ledger data found."}</p>
        <button
          onClick={fetchLedgerData}
          className="mt-4 px-4 py-2 bg-red-800 hover:bg-red-700 text-white rounded-lg text-xs transition"
        >
          Retry
        </button>
      </div>
    );
  }

  const { summary, reconciliation, recentEntries } = data;

  return (
    <div className="space-y-6">
      {/* Reconciliation Drift Alert (Admin or Warning state) */}
      {!reconciliation.balanced && (
        <div className="p-4 bg-amber-950/50 border border-amber-500/50 rounded-xl text-amber-200 flex items-start space-x-3">
          <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-amber-300">Reconciliation Mismatch Detected</h4>
            <p className="text-xs text-amber-200/90 mt-1">{reconciliation.remediationNotes}</p>
            <div className="mt-2 text-xs flex space-x-4 font-mono text-amber-400">
              <span>Calculated Balance: {reconciliation.calculatedNetBalance} XLM</span>
              <span>Stellar On-Chain: {reconciliation.stellarConfirmedBalance} XLM</span>
              <span>Drift: {reconciliation.driftAmount} XLM</span>
            </div>
          </div>
        </div>
      )}

      {reconciliation.balanced && (
        <div className="p-4 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-emerald-300 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-medium">Reconciled with Stellar Ledger</span>
          </div>
          <span className="text-xs text-emerald-400 font-mono">Status: 100% Balanced</span>
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-xs font-medium text-slate-400 flex justify-between items-center">
            <span>Gross Sales</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{summary.grossSales} XLM</div>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-xs font-medium text-slate-400 flex justify-between items-center">
            <span>Platform Fees & Refunds</span>
            <ArrowDownRight className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-300">
            -{(summary.platformFees + summary.refunds).toFixed(2)} XLM
          </div>
          <div className="text-xs text-slate-500 mt-1">Fees: {summary.platformFees} | Refunds: {summary.refunds}</div>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-xs font-medium text-slate-400 flex justify-between items-center">
            <span>Settled Payouts</span>
            <ArrowUpRight className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-300">-{summary.payouts} XLM</div>
        </div>

        <div className="p-4 bg-gradient-to-br from-purple-900/40 to-slate-900 border border-purple-500/30 rounded-xl">
          <div className="text-xs font-medium text-purple-300 flex justify-between items-center">
            <span>Net Creator Balance</span>
            <CheckCircle2 className="w-4 h-4 text-purple-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-purple-200">{summary.netBalance} XLM</div>
        </div>
      </div>

      {/* Entry History Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <h3 className="font-semibold text-white text-sm">Append-Only Payout Ledger</h3>
          {isAdmin && (
            <a
              href={`/api/payouts/admin/export?creatorAddress=${walletAddress}&format=csv`}
              className="flex items-center space-x-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </a>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 uppercase font-mono border-b border-slate-800">
              <tr>
                <th className="p-3">Type</th>
                <th className="p-3">Description</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Stellar Tx</th>
                <th className="p-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {recentEntries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-800/40 transition">
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold ${
                        e.entryType === "sale"
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800/50"
                          : e.entryType === "refund"
                            ? "bg-red-950 text-red-300 border border-red-800/50"
                            : e.entryType === "fee"
                              ? "bg-amber-950 text-amber-300 border border-amber-800/50"
                              : "bg-blue-950 text-blue-300 border border-blue-800/50"
                      }`}
                    >
                      {e.entryType}
                    </span>
                  </td>
                  <td className="p-3 font-medium text-slate-200">{e.description}</td>
                  <td className={`p-3 font-mono font-semibold ${e.amount >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                    {e.amount > 0 ? `+${e.amount}` : e.amount} {e.currency}
                  </td>
                  <td className="p-3 font-mono text-slate-400">
                    {e.stellarTxRef ? (
                      <span className="text-purple-400 truncate max-w-[120px] inline-block">
                        {e.stellarTxRef}
                      </span>
                    ) : (
                      <span className="text-slate-600">Pending</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-400">{new Date(e.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {recentEntries.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-500">
                    No ledger entries recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
