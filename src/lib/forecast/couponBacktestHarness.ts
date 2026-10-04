export interface PerformancePeriodData {
  periodIndex: number;
  periodLabel: string;
  projectEnergyKwh: number;
  expectedEnergyKwh: number;
  revenueCollectedStroops: bigint;
  baseInterestRateBps: number;
}

export type CouponFormulaVersion = "v1_fixed_linear" | "v2_performance_tiered";

export interface ComputedCouponResult {
  periodIndex: number;
  periodLabel: string;
  couponAmountV1Stroops: bigint;
  couponAmountV2Stroops: bigint;
  variancePct: number;
  edgeCaseFlags: string[];
}

export interface BacktestReport {
  datasetName: string;
  totalPeriodsEvaluated: number;
  computedCoupons: ComputedCouponResult[];
  summary: {
    totalCouponV1Stroops: bigint;
    totalCouponV2Stroops: bigint;
    flaggedEdgeCasesCount: number;
    maxVariancePct: number;
  };
  releaseReadinessStatus: "PASSED" | "WARNING_EDGE_CASES_DETECTED";
}

/**
 * On-chain coupon calculation logic (invoked by test harness directly)
 */
export function calculateCouponPayout(
  data: PerformancePeriodData,
  formulaVersion: CouponFormulaVersion
): { payoutStroops: bigint; edgeCaseFlags: string[] } {
  const flags: string[] = [];

  if (data.projectEnergyKwh <= 0) {
    flags.push("ZERO_OR_NEGATIVE_ENERGY_OUTPUT");
  }

  if (data.expectedEnergyKwh <= 0) {
    flags.push("INVALID_EXPECTED_BENCHMARK");
  }

  const performanceRatio = data.expectedEnergyKwh > 0
    ? data.projectEnergyKwh / data.expectedEnergyKwh
    : 0;

  if (performanceRatio < 0.5) {
    flags.push("CRITICAL_UNDERPERFORMANCE_BELOW_50_PCT");
  } else if (performanceRatio > 2.0) {
    flags.push("EXTREME_OVERPERFORMANCE_ABOVE_200_PCT");
  }

  if (formulaVersion === "v1_fixed_linear") {
    // V1 Formula: Fixed Linear Rate = baseInterestRateBps * revenue
    const bps = BigInt(Math.max(0, data.baseInterestRateBps));
    const payout = (data.revenueCollectedStroops * bps) / 10_000n;
    return { payoutStroops: payout, edgeCaseFlags: flags };
  }

  // V2 Formula: Performance-Tiered Rate with Performance Ratio Scaling & Floor
  const adjustedRatio = Math.max(0.1, Math.min(1.5, performanceRatio));
  const tieredBps = BigInt(Math.round(data.baseInterestRateBps * adjustedRatio));
  const payoutV2 = (data.revenueCollectedStroops * tieredBps) / 10_000n;

  if (payoutV2 > data.revenueCollectedStroops) {
    flags.push("PAYOUT_EXCEEDS_REVENUE_CAP");
  }

  return { payoutStroops: payoutV2, edgeCaseFlags: flags };
}

export class CouponBacktestHarness {
  /**
   * Run backtest against imported multi-year historical or synthetic performance dataset
   */
  public runBacktest(
    datasetName: string,
    dataset: PerformancePeriodData[]
  ): BacktestReport {
    let totalV1 = 0n;
    let totalV2 = 0n;
    let maxVariance = 0;
    let totalFlags = 0;

    const computedCoupons: ComputedCouponResult[] = [];

    for (const item of dataset) {
      const v1 = calculateCouponPayout(item, "v1_fixed_linear");
      const v2 = calculateCouponPayout(item, "v2_performance_tiered");

      // Merge unique edge case flags
      const combinedFlags = Array.from(new Set([...v1.edgeCaseFlags, ...v2.edgeCaseFlags]));
      if (combinedFlags.length > 0) {
        totalFlags += combinedFlags.length;
      }

      totalV1 += v1.payoutStroops;
      totalV2 += v2.payoutStroops;

      // Variance calculation
      const val1 = Number(v1.payoutStroops);
      const val2 = Number(v2.payoutStroops);
      const variancePct = val1 > 0 ? (Math.abs(val2 - val1) / val1) * 100 : 0;
      if (variancePct > maxVariance) {
        maxVariance = variancePct;
      }

      computedCoupons.push({
        periodIndex: item.periodIndex,
        periodLabel: item.periodLabel,
        couponAmountV1Stroops: v1.payoutStroops,
        couponAmountV2Stroops: v2.payoutStroops,
        variancePct: Number(variancePct.toFixed(2)),
        edgeCaseFlags: combinedFlags,
      });
    }

    return {
      datasetName,
      totalPeriodsEvaluated: dataset.length,
      computedCoupons,
      summary: {
        totalCouponV1Stroops: totalV1,
        totalCouponV2Stroops: totalV2,
        flaggedEdgeCasesCount: totalFlags,
        maxVariancePct: Number(maxVariance.toFixed(2)),
      },
      releaseReadinessStatus: totalFlags > 0 ? "WARNING_EDGE_CASES_DETECTED" : "PASSED",
    };
  }
}
