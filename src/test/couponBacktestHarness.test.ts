import { describe, it, expect, beforeEach } from "vitest";
import {
  CouponBacktestHarness,
  PerformancePeriodData,
} from "../lib/forecast/couponBacktestHarness";

describe("Coupon Math Historical Performance Backtesting Harness (#333)", () => {
  let harness: CouponBacktestHarness;

  const multiYearDataset: PerformancePeriodData[] = [
    {
      periodIndex: 1,
      periodLabel: "Year 1 - Q1",
      projectEnergyKwh: 100_000,
      expectedEnergyKwh: 100_000,
      revenueCollectedStroops: 50_000_000_000n, // 5,000 XLM
      baseInterestRateBps: 500, // 5%
    },
    {
      periodIndex: 2,
      periodLabel: "Year 1 - Q2 (Extreme Overperformance)",
      projectEnergyKwh: 220_000,
      expectedEnergyKwh: 100_000,
      revenueCollectedStroops: 100_000_000_000n,
      baseInterestRateBps: 500,
    },
    {
      periodIndex: 3,
      periodLabel: "Year 1 - Q3 (Critical Underperformance)",
      projectEnergyKwh: 30_000,
      expectedEnergyKwh: 100_000,
      revenueCollectedStroops: 15_000_000_000n,
      baseInterestRateBps: 500,
    },
    {
      periodIndex: 4,
      periodLabel: "Year 1 - Q4 (Zero Energy Output)",
      projectEnergyKwh: 0,
      expectedEnergyKwh: 100_000,
      revenueCollectedStroops: 0n,
      baseInterestRateBps: 500,
    },
  ];

  beforeEach(() => {
    harness = new CouponBacktestHarness();
  });

  it("invokes actual contract logic directly without reimplementation", () => {
    const report = harness.runBacktest("Multi-Year Solar Plant Dataset", multiYearDataset);

    expect(report).toBeDefined();
    expect(report.totalPeriodsEvaluated).toBe(4);
    expect(report.computedCoupons).toHaveLength(4);
  });

  it("produces report comparing formula versions (v1_fixed_linear vs v2_performance_tiered)", () => {
    const report = harness.runBacktest("Multi-Year Solar Plant Dataset", multiYearDataset);

    const period1 = report.computedCoupons[0];
    // Period 1 (100% performance): V1 and V2 match (5% interest)
    expect(period1.couponAmountV1Stroops).toBe(2_500_000_000n);
    expect(period1.couponAmountV2Stroops).toBe(2_500_000_000n);

    // Period 3 (Underperformance 30%): V2 scales down interest rate
    const period3 = report.computedCoupons[2];
    expect(period3.couponAmountV2Stroops).toBeLessThan(period3.couponAmountV1Stroops);
  });

  it("flags edge-case anomalies across historical multi-year performance datasets", () => {
    const report = harness.runBacktest("Multi-Year Solar Plant Dataset", multiYearDataset);

    expect(report.summary.flaggedEdgeCasesCount).toBeGreaterThan(0);

    const period2Flags = report.computedCoupons[1].edgeCaseFlags;
    expect(period2Flags).toContain("EXTREME_OVERPERFORMANCE_ABOVE_200_PCT");

    const period3Flags = report.computedCoupons[2].edgeCaseFlags;
    expect(period3Flags).toContain("CRITICAL_UNDERPERFORMANCE_BELOW_50_PCT");

    const period4Flags = report.computedCoupons[3].edgeCaseFlags;
    expect(period4Flags).toContain("ZERO_OR_NEGATIVE_ENERGY_OUTPUT");

    expect(report.releaseReadinessStatus).toBe("WARNING_EDGE_CASES_DETECTED");
  });
});
