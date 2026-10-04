# Coupon Math Historical Performance Backtesting Release Process

## Overview
To guarantee that modifications to on-chain coupon calculation formulas behave correctly across real-world scenarios prior to production deployment, all coupon formula changes must pass historical performance backtesting.

## Release Process Verification
1. **Direct Contract Invocations**: The test harness invokes the actual on-chain coupon contract logic (`calculateCouponPayout()`), ensuring zero drift from production execution.
2. **Multi-Year Dataset Evaluation**: Imported datasets must cover at least 3 years of historical or synthetic project performance metrics.
3. **Formula Version Comparison**: The harness generates comparative metrics between current (`v1_fixed_linear`) and proposed (`v2_performance_tiered`) formula versions.
4. **Edge-Case Detection**: The harness flags critical underperformance ($< 50\%$), extreme overperformance ($> 200\%$), zero energy output, and revenue cap overflows.

## Pre-Release Command
Run the automated backtesting suite as part of the mandatory release checklist:
```bash
npx vitest run src/test/couponBacktestHarness.test.ts
```
