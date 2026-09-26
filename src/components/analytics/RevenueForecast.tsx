import { useMemo } from "react";
import { TrendingUp, AlertTriangle, Info, Coins, BarChart3, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/Skeleton";
import { forecastRevenue, type ForecastingInputs, type ForecastResult } from "@/lib/forecast/revenueForecast";

interface RevenueForecastProps {
  inputs: ForecastingInputs;
  isLoading?: boolean;
}

/**
 * Revenue forecast widget — shows 7/30/90 day ranges with assumptions and confidence.
 * All values are clearly labeled as estimates. Sparse data shows explanatory empty state.
 */
export function RevenueForecast({ inputs, isLoading = false }: RevenueForecastProps) {
  const result: ForecastResult = useMemo(
    () => forecastRevenue(inputs, new Date().toISOString().slice(0, 10)),
    [inputs]
  );

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4" data-testid="revenue-forecast-skeleton">
        <Skeleton className="h-5 w-40" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      </div>
    );
  }

  const confidenceTone: Record<ForecastResult["confidence"], string> = {
    high: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    medium: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    low: "border-slate-400/30 bg-slate-400/10 text-slate-300",
  };

  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4"
      data-testid="revenue-forecast"
      data-confidence={result.confidence}
      data-insufficient={String(result.insufficientData)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Revenue forecast</h3>
            <p className="text-xs text-slate-500">Estimate · as of {result.asOf} · {result.windowDays}-day window</p>
          </div>
        </div>
        <Badge className={confidenceTone[result.confidence]} data-testid="forecast-confidence">
          {result.confidence === "high" ? "High confidence" : result.confidence === "medium" ? "Medium confidence" : "Low confidence"}
        </Badge>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Forecasts are <span className="font-semibold text-slate-300">estimates</span> based only on your own sales,
        active listings, and refund history. No platform-wide private benchmarks are used. Past performance does not guarantee future results.
      </p>

      {result.insufficientData || !result.forecasts ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center" data-testid="forecast-empty">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
            <Clock className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-semibold text-white">Not enough data yet</p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{result.insufficientReason}</p>
          <ul className="mt-3 text-left mx-auto max-w-md space-y-1.5 text-xs text-slate-500 list-disc list-inside">
            {result.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([7, 30, 90] as const).map((horizon) => {
              const range = result.forecasts![horizon];
              return (
                <div key={horizon} className="rounded-xl border border-white/10 bg-white/[0.02] p-4" data-testid={`forecast-${horizon}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{horizon} days</p>
                  <p className="mt-1 text-lg font-bold text-white">
                    {range.base.toFixed(2)} XLM
                    <span className="ml-1 text-xs font-normal text-slate-500">estimate</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Range: <span className="font-mono text-slate-300">{range.low.toFixed(2)}</span>
                    {" – "}
                    <span className="font-mono text-slate-300">{range.high.toFixed(2)}</span> XLM
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">Net after {(0.05 * 100).toFixed(0)}% fee & refunds</p>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-slate-500" />
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Assumptions</p>
            </div>
            <ul className="space-y-1.5 text-xs leading-relaxed text-slate-400 list-disc list-inside">
              {result.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
            <div className="flex items-start gap-2 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.04] p-2.5">
              <Info className="h-3.5 w-3.5 mt-0.5 text-cyan-300 shrink-0" />
              <p className="text-xs leading-relaxed text-slate-300">
                Confidence: <span className="font-semibold">{result.confidence}</span> — {result.confidenceReason}
              </p>
            </div>
            {result.warnings.length > 0 && (
              <div className="space-y-1.5">
                {result.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] p-2.5" data-testid="forecast-warning">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-300 shrink-0" />
                    <p className="text-xs leading-relaxed text-amber-200/90">{w}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Coins className="h-3 w-3" />
              Avg daily net {result.inputs.avgDailyNet.toFixed(2)} XLM · volatility {(result.inputs.volatility * 100).toFixed(0)}% (CV)
              · trend {(result.inputs.trendFactor * 100).toFixed(1)}%
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Re-export for tests that import from component barrel
export type { ForecastResult };
