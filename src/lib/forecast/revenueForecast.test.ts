import { describe, it, expect } from "vitest";
import { forecastRevenue, generateDeterministicHistory } from "./revenueForecast";

describe("revenueForecast", () => {
  it("produces stable forecast with low volatility and low refunds (high confidence)", () => {
    const history = generateDeterministicHistory(30, 20, 0, 0); // stable ~20 XLM/day, low volatility
    const result = forecastRevenue(
      {
        dailyHistory: history,
        activeListings: 5,
        totalListings: 5,
        conversionRate: 0.04,
        refundRate: 0.02,
        viewCount: 2000,
        windowDays: 30,
      },
      "2025-02-01"
    );
    expect(result.insufficientData).toBe(false);
    expect(result.forecasts).not.toBeNull();
    expect(result.confidence).toBe("high");
    expect(result.forecasts![30].low).toBeLessThan(result.forecasts![30].base);
    expect(result.forecasts![30].high).toBeGreaterThan(result.forecasts![30].base);
    expect(result.label).toBe("estimate");
    expect(result.assumptions.length).toBeGreaterThan(0);
    // deterministic: same inputs produce same outputs
    const again = forecastRevenue(
      {
        dailyHistory: history,
        activeListings: 5,
        totalListings: 5,
        conversionRate: 0.04,
        refundRate: 0.02,
        viewCount: 2000,
        windowDays: 30,
      },
      "2025-02-01"
    );
    expect(again.forecasts).toEqual(result.forecasts);
  });

  it("returns empty state when data is sparse (<7 days)", () => {
    const history = generateDeterministicHistory(3, 10, 0, 0);
    const result = forecastRevenue(
      {
        dailyHistory: history,
        activeListings: 2,
        totalListings: 2,
        conversionRate: 0.03,
        refundRate: 0.01,
      },
      "2025-02-01"
    );
    expect(result.insufficientData).toBe(true);
    expect(result.forecasts).toBeNull();
    expect(result.insufficientReason).toMatch(/Not enough sales history/);
    expect(result.confidence).toBe("low");
  });

  it("widens range and lowers confidence for high volatility", () => {
    // Construct stable vs volatile histories manually for clear separation
    const stable = Array.from({ length: 30 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, "0")}`,
      unitsSold: 4,
      grossRevenueXlm: 20, // perfectly stable
    }));
    const volatile = Array.from({ length: 30 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, "0")}`,
      unitsSold: i % 2 === 0 ? 1 : 7,
      grossRevenueXlm: i % 2 === 0 ? 5 : 35, // high variance
    }));
    const stableRes = forecastRevenue(
      { dailyHistory: stable, activeListings: 3, totalListings: 3, conversionRate: 0.03, refundRate: 0.02 },
      "2025-02-01"
    );
    const volatileRes = forecastRevenue(
      { dailyHistory: volatile, activeListings: 3, totalListings: 3, conversionRate: 0.03, refundRate: 0.02 },
      "2025-02-01"
    );
    expect(volatileRes.inputs.volatility).toBeGreaterThan(stableRes.inputs.volatility);
    // volatile range should be wider
    const stableWidth = stableRes.forecasts![30].high - stableRes.forecasts![30].low;
    const volatileWidth = volatileRes.forecasts![30].high - volatileRes.forecasts![30].low;
    expect(volatileWidth).toBeGreaterThan(stableWidth);
    expect(volatileRes.warnings.join(" ")).toMatch(/volatility/i);
  });

  it("caps forecast and warns on high refund rates", () => {
    const history = generateDeterministicHistory(30, 25, 0, 0);
    const lowRefund = forecastRevenue(
      { dailyHistory: history, activeListings: 4, totalListings: 4, conversionRate: 0.05, refundRate: 0.02 },
      "2025-02-01"
    );
    const highRefund = forecastRevenue(
      { dailyHistory: history, activeListings: 4, totalListings: 4, conversionRate: 0.05, refundRate: 0.35 },
      "2025-02-01"
    );
    expect(highRefund.forecasts![30].base).toBeLessThan(lowRefund.forecasts![30].base);
    expect(highRefund.warnings.join(" ")).toMatch(/refund/i);
    expect(highRefund.confidence).not.toBe("high");
  });

  it("returns zero forecast when no active listings", () => {
    const history = generateDeterministicHistory(30, 15, 0, 0);
    const result = forecastRevenue(
      { dailyHistory: history, activeListings: 0, totalListings: 5, conversionRate: 0.02, refundRate: 0.02 },
      "2025-02-01"
    );
    expect(result.forecasts![30].base).toBe(0);
    expect(result.forecasts![7].base).toBe(0);
  });

  it("is deterministic regardless of windowDays slicing", () => {
    const history = generateDeterministicHistory(60, 10, 1, 0.1);
    const a = forecastRevenue({ dailyHistory: history, activeListings: 2, totalListings: 2, conversionRate: null, refundRate: null, windowDays: 30 }, "2025-03-01");
    const b = forecastRevenue({ dailyHistory: history, activeListings: 2, totalListings: 2, conversionRate: null, refundRate: null, windowDays: 30 }, "2025-03-01");
    expect(a).toEqual(b);
  });

  it("handles null conversion/refund without platform benchmarks", () => {
    const history = generateDeterministicHistory(30, 12, 0, 0);
    const result = forecastRevenue(
      { dailyHistory: history, activeListings: 2, totalListings: 2, conversionRate: null, refundRate: null },
      "2025-02-01"
    );
    expect(result.insufficientData).toBe(false);
    expect(result.assumptions.join(" ")).toContain("Conversion rate unavailable");
    // Should not leak platform-wide *private* benchmarks (e.g. "median creator revenue")
    expect(JSON.stringify(result)).not.toMatch(/median creator/i);
    expect(JSON.stringify(result)).not.toMatch(/platform average revenue/i);
  });
});
