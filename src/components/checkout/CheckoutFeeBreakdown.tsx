import { AlertTriangle, ShieldCheck, HelpCircle } from "lucide-react";
import {
  calculatePaymentBreakdown,
  FeeConfig,
  DEFAULT_FEE_BPS,
} from "@/lib/checkout/feeCalculator";

interface CheckoutFeeBreakdownProps {
  promptTitle: string;
  priceXlm: string | number;
  feeConfig?: FeeConfig | null;
  className?: string;
}

export function CheckoutFeeBreakdown({
  promptTitle,
  priceXlm,
  feeConfig = { feeBps: DEFAULT_FEE_BPS, asset: "XLM", isAvailable: true },
  className = "",
}: CheckoutFeeBreakdownProps) {
  const breakdown = calculatePaymentBreakdown(priceXlm, feeConfig);

  if (!breakdown.isAvailable) {
    return (
      <div className={`p-4 rounded-xl border border-red-500/30 bg-red-950/20 text-red-300 space-y-2 ${className}`}>
        <div className="flex items-center gap-2 font-bold text-sm">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <span>Checkout Blocked: Fee Configuration Error</span>
        </div>
        <p className="text-xs text-red-300/80">
          {breakdown.errorMessage || "Fee configuration is missing or unavailable. Checkout is disabled until network fees can be verified."}
        </p>
      </div>
    );
  }

  const feePercentageFormatted = (breakdown.feeBps / 100).toFixed(2);

  return (
    <div className={`p-4 rounded-xl border border-white/10 bg-slate-900/80 space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Payment Breakdown</h4>
        <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
          Asset: {breakdown.asset}
        </span>
      </div>

      {/* Stale config warning */}
      {breakdown.isStale && (
        <div className="flex items-center gap-2 p-2 rounded-lg border border-amber-500/30 bg-amber-950/30 text-amber-300 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>Warning: Fee configuration is stale. Rates may update prior to signing.</span>
        </div>
      )}

      {/* Breakdown lines */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center text-slate-300">
          <span className="text-slate-400">Prompt Price ({promptTitle})</span>
          <span className="font-mono text-white">{breakdown.promptPriceXlm} {breakdown.asset}</span>
        </div>

        <div className="flex justify-between items-center text-slate-300">
          <span className="flex items-center gap-1 text-slate-400">
            Platform Fee ({feePercentageFormatted}%)
            <span className="group relative cursor-pointer text-slate-500 hover:text-slate-300">
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
          </span>
          <span className="font-mono text-slate-300">{breakdown.platformFeeXlm} {breakdown.asset}</span>
        </div>

        <div className="flex justify-between items-center text-slate-300">
          <span className="text-slate-400">Creator Amount (Net)</span>
          <span className="font-mono text-emerald-400 font-medium">{breakdown.creatorAmountXlm} {breakdown.asset}</span>
        </div>

        <div className="pt-2 border-t border-white/10 flex justify-between items-center font-bold text-base">
          <span className="text-white">Total Charged to Buyer</span>
          <span className="font-mono text-emerald-400 text-lg">{breakdown.totalChargedXlm} {breakdown.asset}</span>
        </div>
      </div>

      {/* Verification note */}
      <div className="pt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <span>Totals match exact Soroban smart contract input parameters.</span>
      </div>
    </div>
  );
}
