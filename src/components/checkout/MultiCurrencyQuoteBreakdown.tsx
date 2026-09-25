import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Clock, RefreshCw, ShieldCheck, HelpCircle, Coins } from "lucide-react";
import {
  generatePriceQuote,
  validateQuoteForPurchase,
  PriceQuote,
  SUPPORTED_ASSET_CONFIGS,
  xlmToStroopsBigInt,
} from "@/lib/checkout/priceQuoter";

// Fallback helper for converting price input to Stroops
function safeToStroops(priceInput: bigint | string | number): bigint {
  if (typeof priceInput === "bigint") return priceInput;
  try {
    return xlmToStroopsBigInt(priceInput);
  } catch {
    return 0n;
  }
}

export interface MultiCurrencyQuoteBreakdownProps {
  promptTitle: string;
  promptId: string | bigint;
  basePriceStroops: bigint | string | number;
  buyerAddress?: string;
  onQuoteChange?: (quote: PriceQuote | null, isValid: boolean) => void;
  className?: string;
}

export function MultiCurrencyQuoteBreakdown({
  promptTitle,
  promptId,
  basePriceStroops,
  buyerAddress,
  onQuoteChange,
  className = "",
}: MultiCurrencyQuoteBreakdownProps) {
  const [selectedAsset, setSelectedAsset] = useState<string>("XLM");
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  const priceStroops = safeToStroops(basePriceStroops);

  // Generate a fresh quote
  const handleRefreshQuote = useCallback(() => {
    if (priceStroops <= 0n) {
      setQuote(null);
      setTimeRemaining(0);
      onQuoteChange?.(null, false);
      return;
    }

    const newQuote = generatePriceQuote({
      promptId,
      baseAmountStroops: priceStroops,
      targetAsset: selectedAsset,
      buyerAddress,
      ttlSeconds: 60,
    });

    setQuote(newQuote);
    const remaining = Math.max(0, Math.ceil((newQuote.expiresAt - Date.now()) / 1000));
    setTimeRemaining(remaining);

    const validation = validateQuoteForPurchase(newQuote, {
      promptId,
      requestedAsset: selectedAsset,
    });

    onQuoteChange?.(newQuote, validation.isValid);
  }, [promptId, priceStroops, selectedAsset, buyerAddress, onQuoteChange]);

  // Initial quote generation and on asset change
  useEffect(() => {
    handleRefreshQuote();
  }, [handleRefreshQuote]);

  // Countdown timer effect
  useEffect(() => {
    if (!quote) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((quote.expiresAt - now) / 1000));
      setTimeRemaining(remaining);

      const validation = validateQuoteForPurchase(quote, {
        promptId,
        requestedAsset: selectedAsset,
        now,
      });

      onQuoteChange?.(quote, validation.isValid);
    }, 1000);

    return () => clearInterval(interval);
  }, [quote, promptId, selectedAsset, onQuoteChange]);

  const isExpired = timeRemaining <= 0;
  const supportedAssetList = Object.values(SUPPORTED_ASSET_CONFIGS);

  if (priceStroops <= 0n || !quote) {
    return (
      <div className={`p-4 rounded-xl border border-red-500/30 bg-red-950/20 text-red-300 ${className}`}>
        <div className="flex items-center gap-2 font-bold text-sm">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <span>Quote Unavailable</span>
        </div>
        <p className="text-xs text-red-300/80 mt-1">
          Invalid prompt price or fee configuration. Settlement disabled.
        </p>
      </div>
    );
  }

  const feePercentageFormatted = (quote.feeBps / 100).toFixed(2);

  return (
    <div
      className={`p-4 sm:p-5 rounded-2xl border border-white/10 bg-slate-900/90 shadow-xl space-y-4 ${className}`}
      data-testid="multi-currency-quote-breakdown"
    >
      {/* Header & Asset Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5 text-emerald-400" /> Multi-Currency Quote
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Slippage and conversion protected for Stellar settlement
          </p>
        </div>

        {/* Supported Assets Selector */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-white/10">
          {supportedAssetList.map((asset) => {
            const isSelected = asset.code === selectedAsset;
            return (
              <button
                key={asset.code}
                type="button"
                onClick={() => setSelectedAsset(asset.code)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  isSelected
                    ? "bg-emerald-500 text-slate-950 shadow-md"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
                aria-pressed={isSelected}
              >
                {asset.code}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversion Rate & Expiry Status Banner */}
      <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5 text-xs">
        <div className="flex items-center gap-1.5 font-mono text-slate-300">
          <span className="text-slate-400">Rate:</span>
          <span className="text-emerald-300 font-semibold">{quote.conversionRate.formattedRate}</span>
        </div>

        {/* Expiry Badge */}
        <div className="flex items-center gap-2">
          {isExpired ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse">
              <AlertTriangle className="h-3.5 w-3.5" /> Quote Expired
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-bold ${
                timeRemaining <= 10
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              }`}
            >
              <Clock className="h-3.5 w-3.5" /> {timeRemaining}s
            </span>
          )}

          <button
            type="button"
            onClick={handleRefreshQuote}
            className="p-1 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Refresh price quote"
            aria-label="Refresh price quote"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Expired Quote Warning Banner */}
      {isExpired && (
        <div className="p-3 rounded-xl border border-red-500/40 bg-red-950/40 text-red-300 space-y-2 text-xs">
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <span>Expired quotes cannot be used for purchase settlement.</span>
          </div>
          <p className="text-[11px] text-red-300/90 leading-relaxed">
            Stale conversion rates are protected. Click &quot;Refresh Quote&quot; to lock in the latest rate before signing.
          </p>
          <button
            type="button"
            onClick={handleRefreshQuote}
            className="w-full py-1.5 rounded-lg bg-red-500 hover:bg-red-400 text-slate-950 font-bold transition-all flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh Quote Now
          </button>
        </div>
      )}

      {/* Quote Breakdown Lines */}
      <div className="space-y-2.5 text-xs sm:text-sm">
        <div className="flex justify-between items-center text-slate-300">
          <span className="text-slate-400">Prompt Price ({promptTitle})</span>
          <span className="font-mono font-semibold text-white">
            {quote.quoteAmountFormatted} {quote.quoteAsset}
          </span>
        </div>

        <div className="flex justify-between items-center text-slate-300">
          <span className="flex items-center gap-1 text-slate-400">
            Platform Fee ({feePercentageFormatted}%)
            <span className="group relative cursor-pointer text-slate-500 hover:text-slate-300">
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
          </span>
          <span className="font-mono text-slate-300">
            {quote.platformFeeFormatted} {quote.quoteAsset}
          </span>
        </div>

        <div className="flex justify-between items-center text-slate-300">
          <span className="text-slate-400">Creator Amount (Net)</span>
          <span className="font-mono text-emerald-400 font-medium">
            {quote.creatorAmountFormatted} {quote.quoteAsset}
          </span>
        </div>

        <div className="flex justify-between items-center text-slate-400 text-xs">
          <span>Slippage Protection Buffer (+{quote.slippageBps / 100}%)</span>
          <span className="font-mono text-slate-400">
            Max Ceiling: {quote.maxChargeFormatted} {quote.quoteAsset}
          </span>
        </div>

        <div className="pt-2 border-t border-white/10 flex justify-between items-center font-bold text-sm sm:text-base">
          <span className="text-white">Total Quoted Settlement</span>
          <span className="font-mono text-emerald-400 text-base sm:text-lg">
            {quote.quoteAmountFormatted} {quote.quoteAsset}
          </span>
        </div>
      </div>

      {/* Security Footer Note */}
      <div className="pt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <span>Integer-safe conversion with {quote.ttlSeconds}s predictable expiry protection.</span>
      </div>
    </div>
  );
}
