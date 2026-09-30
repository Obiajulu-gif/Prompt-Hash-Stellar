/**
 * Revenue forecasting — marketplace creator revenue estimates
 *
 * Aggregates: historical sales, active listings, conversion trends, refund rates
 * Produces: forecast ranges with assumptions and confidence indicators.
 * Safeguards: sparse data, volatile data, high refund rates.
 *
 * DO NOT expose platform-wide private benchmarks — all inputs are per-creator
 * and derived from that creator's own marketplace data.
 *
 * Formula (documented assumptions):
 * 1. Base daily net revenue = avgDailyGross * (1 - refundRate) * (1 - platformFee)
 *    where avgDailyGross = mean(dailyGross) over windowDays (default 30)
 * 2. Trend factor = clamp(linearSlope / avgDailyGross, -0.5, 0.5)
 *    Positive trend increases future daily expectation, negative decreases.
 * 3. Listing factor = min(1, activeListings / max(1, totalListings)) — if many
 *    listings are inactive, forecast is capped; if no active listings, 0.
 * 4. Volatility = coefficient of variation = stdDev / mean (capped 0–1)
 * 5. Horizon forecast = baseDaily * days * (1 + trendFactor * sqrt(days/30)) * listingFactor
 * 6. Confidence interval widens with volatility, sparse data, and high refunds:
 *    lower = forecast * (1 - (volatility*0.6 + sparsePenalty + refundPenalty))
 *    upper = forecast * (1 + (volatility*0.6 + sparsePenalty + refundPenalty*0.5))
 *    where sparsePenalty = 0.25 if dataPoints < 14, 0.15 if < 30, else 0
 *          refundPenalty = min(0.3, refundRate * 1.5) when refundRate > 0.1
 * 7. Confidence label: high (volatility <0.3, dataPoints>=30, refundRate<0.05),
 *    medium (volatility <0.6, dataPoints>=14), else low.
 *
 * Determinism: pure functions, no randomness, no Date.now() inside core calc
 * — `asOf` date is an explicit param so tests are reproducible.
 */

export interface DailyRevenuePoint {
  date: string; // YYYY-MM-DD
  unitsSold: number;
  grossRevenueXlm: number; // gross before refunds/fees
  refundsXlm?: number;
  netRevenueXlm?: number;
}

export interface ForecastingInputs {
  /** Per-day gross revenue history, most recent last. Must be sorted ascending by date */
  dailyHistory: DailyRevenuePoint[];
  /** Creator's active vs total listings snapshot */
  activeListings: number;
  totalListings: number;
  /** Derived from sellerAnalytics: purchases / views */
  conversionRate: number | null;
  /** refunds / purchases */
  refundRate: number | null;
  /** Total preview/views in window — used only to guard conversionRate reliability */
  viewCount?: number;
  /** Window days to average (default 30) */
  windowDays?: number;
}

export interface ForecastRange {
  low: number;
  base: number;
  high: number;
}

export type ConfidenceLevel = "high" | "medium" | "low";
export type ForecastHorizon = 7 | 30 | 90;

export interface ForecastResult {
  /** Always labeled as estimate in UI — never a guarantee */
  label: "estimate";
  asOf: string;
  windowDays: number;
  inputs: {
    dataPoints: number;
    activeListings: number;
    totalListings: number;
    avgDailyGross: number;
    avgDailyNet: number;
    refundRate: number;
    conversionRate: number | null;
    volatility: number; // 0–1 CV
    trendFactor: number; // -0.5..0.5
  };
  assumptions: string[];
  warnings: string[];
  confidence: ConfidenceLevel;
  confidenceReason: string;
  /** null when data is insufficient — caller must show empty state */
  forecasts: Record<ForecastHorizon, ForecastRange> | null;
  insufficientData: boolean;
  insufficientReason?: string;
}

const PLATFORM_FEE_RATE = 0.05;
const MIN_DATA_POINTS = 7;
const PREFERRED_DATA_POINTS = 14;
const IDEAL_DATA_POINTS = 30;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export function aggregateForecastingInputs(inputs: ForecastingInputs): Omit<ForecastResult, "forecasts" | "insufficientData" | "insufficientReason"> & { availableDays: number } {
  const windowDays = inputs.windowDays ?? 30;
  const slice = inputs.dailyHistory.slice(-windowDays);
  const dataPoints = slice.length;
  const grossValues = slice.map(d => d.grossRevenueXlm);
  const avgDailyGross = mean(grossValues);
  const sd = stdDev(grossValues, avgDailyGross);
  const volatility = avgDailyGross > 0 ? Math.min(1, sd / avgDailyGross) : 0;
  const slope = linearSlope(grossValues);
  const trendFactor = avgDailyGross > 0 ? Math.max(-0.5, Math.min(0.5, slope / avgDailyGross)) : 0;
  const refundRate = inputs.refundRate ?? 0;
  const netFactor = Math.max(0, (1 - refundRate) * (1 - PLATFORM_FEE_RATE));
  const avgDailyNet = avgDailyGross * netFactor;

  const assumptions: string[] = [
    `Avg daily gross ${avgDailyGross.toFixed(2)} XLM over last ${dataPoints} days in ${windowDays}-day window.`,
    `Platform fee ${(PLATFORM_FEE_RATE * 100).toFixed(0)}% deducted; refund rate ${(refundRate * 100).toFixed(1)}% applied.`,
    `Trend factor ${(trendFactor * 100).toFixed(1)}% (slope vs mean, clamped ±50%).`,
    `Listing factor based on active ${inputs.activeListings}/${inputs.totalListings} listings; paused listings do not contribute.`,
    inputs.conversionRate !== null ? `Observed conversion ${(inputs.conversionRate * 100).toFixed(1)}% (purchases/views).` : `Conversion rate unavailable — no shared benchmarks are used.`,
  ];

  const warnings: string[] = [];
  if (volatility > 0.6) warnings.push(`High volatility (CV ${(volatility * 100).toFixed(0)}%): daily revenue varies widely — range is intentionally broad.`);
  else if (volatility > 0.3) warnings.push(`Moderate volatility (CV ${(volatility * 100).toFixed(0)}%) — treat estimate as directional.`);
  if (refundRate > 0.2) warnings.push(`High refund rate ${(refundRate * 100).toFixed(0)}% caps net revenue; address listing quality.`);
  else if (refundRate > 0.1) warnings.push(`Elevated refund rate ${(refundRate * 100).toFixed(0)}% reduces net forecast.`);
  if (inputs.activeListings === 0 && inputs.totalListings > 0) warnings.push(`No active listings — forecast is zero until a listing is re-activated.`);
  if (inputs.conversionRate !== null && inputs.viewCount !== undefined && inputs.viewCount < 100) warnings.push(`Low view count (${inputs.viewCount}) — conversion signal is noisy.`);

  let confidence: ConfidenceLevel = "low";
  let confidenceReason = "";
  if (dataPoints >= IDEAL_DATA_POINTS && volatility < 0.3 && refundRate < 0.05) {
    confidence = "high";
    confidenceReason = `${dataPoints} days of stable history (CV <30%) and low refunds.`;
  } else if (dataPoints >= PREFERRED_DATA_POINTS && volatility < 0.6 && refundRate < 0.15) {
    confidence = "medium";
    confidenceReason = `${dataPoints} days, moderate stability.`;
  } else {
    confidence = "low";
    if (dataPoints < MIN_DATA_POINTS) confidenceReason = `Only ${dataPoints} days of history — insufficient for a stable estimate.`;
    else if (volatility >= 0.6) confidenceReason = `High volatility — past revenue swings widen the range.`;
    else if (refundRate >= 0.15) confidenceReason = `High refund rate reduces predictability.`;
    else confidenceReason = `Limited history or high variance — use as rough estimate only.`;
  }

  return {
    label: "estimate",
    asOf: "", // filled by caller
    windowDays,
    inputs: {
      dataPoints,
      activeListings: inputs.activeListings,
      totalListings: inputs.totalListings,
      avgDailyGross,
      avgDailyNet,
      refundRate,
      conversionRate: inputs.conversionRate,
      volatility,
      trendFactor,
    },
    assumptions,
    warnings,
    confidence,
    confidenceReason,
    availableDays: dataPoints,
  };
}

export function forecastRevenue(inputs: ForecastingInputs, asOf: string = new Date().toISOString().slice(0, 10)): ForecastResult {
  const agg = aggregateForecastingInputs(inputs);
  const dataPoints = agg.availableDays;

  // Sparse data safeguard
  if (dataPoints < MIN_DATA_POINTS) {
    return {
      label: "estimate",
      asOf,
      windowDays: agg.windowDays,
      inputs: agg.inputs,
      assumptions: agg.assumptions,
      warnings: agg.warnings,
      confidence: "low",
      confidenceReason: `Only ${dataPoints} days — need at least ${MIN_DATA_POINTS} to forecast.`,
      forecasts: null,
      insufficientData: true,
      insufficientReason: `Not enough sales history yet (${dataPoints}/${MIN_DATA_POINTS} days). Keep selling — forecasts appear once you have a week of data. No shared benchmarks are used.`,
    };
  }

  if (agg.inputs.activeListings === 0) {
    const zeroRange: ForecastRange = { low: 0, base: 0, high: 0 };
    return {
      label: "estimate",
      asOf,
      windowDays: agg.windowDays,
      inputs: agg.inputs,
      assumptions: agg.assumptions,
      warnings: agg.warnings,
      confidence: "low",
      confidenceReason: "No active listings — revenue is zero until a listing is active.",
      forecasts: { 7: zeroRange, 30: zeroRange, 90: zeroRange },
      insufficientData: false,
    };
  }

  const listingFactor = Math.min(1, agg.inputs.activeListings / Math.max(1, agg.inputs.totalListings));
  // If single active listing but many total, still allow full factor — marketplace favors active
  // Cap only when clearly diluted; use harmonic-ish: if active >=1, floor at 0.5 + 0.5*ratio
  const effectiveListingFactor = agg.inputs.totalListings > 0
    ? 0.5 + 0.5 * listingFactor
    : 1;

  const horizons: ForecastHorizon[] = [7, 30, 90];
  const forecasts = {} as Record<ForecastHorizon, ForecastRange>;

  const sparsePenalty = dataPoints < PREFERRED_DATA_POINTS ? 0.25 : dataPoints < IDEAL_DATA_POINTS ? 0.15 : 0;
  const refundPenalty = agg.inputs.refundRate > 0.1 ? Math.min(0.3, agg.inputs.refundRate * 1.5) : 0;

  for (const days of horizons) {
    const trendMultiplier = 1 + agg.inputs.trendFactor * Math.sqrt(days / 30);
    const base = agg.inputs.avgDailyNet * days * trendMultiplier * effectiveListingFactor;

    const volSpread = agg.inputs.volatility * 0.6;
    const lowerFactor = 1 - (volSpread + sparsePenalty + refundPenalty);
    const upperFactor = 1 + (volSpread + sparsePenalty + refundPenalty * 0.5);

    // Ensure low <= base <= high and non-negative
    const low = Math.max(0, base * Math.max(0.1, lowerFactor));
    const high = base * upperFactor;

    forecasts[days] = {
      low: Math.round(low * 100) / 100,
      base: Math.round(base * 100) / 100,
      high: Math.round(high * 100) / 100,
    };
  }

  const isInsufficient = false;

  return {
    label: "estimate",
    asOf,
    windowDays: agg.windowDays,
    inputs: agg.inputs,
    assumptions: agg.assumptions,
    warnings: agg.warnings,
    confidence: agg.confidence,
    confidenceReason: agg.confidenceReason,
    forecasts,
    insufficientData: isInsufficient,
  };
}

/**
 * Helper for tests: generate deterministic daily history.
 * No randomness — sequence is fully determined by seed params.
 */
export function generateDeterministicHistory(days: number, baseRevenue: number, volatilitySeed: number = 0, trendPerDay: number = 0): DailyRevenuePoint[] {
  const out: DailyRevenuePoint[] = [];
  for (let i = 0; i < days; i++) {
    // Deterministic pseudo-noise via sin
    const noise = Math.sin(i * 0.7 + volatilitySeed) * baseRevenue * 0.2 * (volatilitySeed === 0 ? 0.3 : 1);
    const gross = Math.max(0, baseRevenue + noise + trendPerDay * i);
    const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
    out.push({ date, unitsSold: Math.max(0, Math.round(gross / 5)), grossRevenueXlm: Math.round(gross * 100) / 100 });
  }
  return out;
}
