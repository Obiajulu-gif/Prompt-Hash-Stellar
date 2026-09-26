import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RevenueForecast } from "./RevenueForecast";
import { generateDeterministicHistory } from "@/lib/forecast/revenueForecast";

describe("RevenueForecast component", () => {
  it("renders estimate label and 7/30/90 ranges with confidence", () => {
    const history = generateDeterministicHistory(30, 20, 0, 0);
    const { container } = render(
      <RevenueForecast
        inputs={{
          dailyHistory: history,
          activeListings: 5,
          totalListings: 5,
          conversionRate: 0.04,
          refundRate: 0.02,
          viewCount: 2000,
        }}
      />
    );
    expect(container.querySelector('[data-testid="revenue-forecast"]')).not.toBeNull();
    expect(screen.getByText(/Revenue forecast/i)).toBeInTheDocument();
    expect(screen.getByText(/estimates/i)).toBeInTheDocument();
    expect(screen.getByTestId("forecast-7")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-30")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-90")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-confidence")).toBeInTheDocument();
  });

  it("shows explanatory empty state when data is sparse", () => {
    const history = generateDeterministicHistory(3, 10, 0, 0);
    render(
      <RevenueForecast
        inputs={{
          dailyHistory: history,
          activeListings: 2,
          totalListings: 2,
          conversionRate: 0.03,
          refundRate: 0.02,
        }}
      />
    );
    expect(screen.getByTestId("forecast-empty")).toBeInTheDocument();
    expect(screen.getByText(/Not enough data yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Not enough sales history/)).toBeInTheDocument();
  });

  it("shows warnings for high refund rates", () => {
    const history = generateDeterministicHistory(30, 20, 0, 0);
    render(
      <RevenueForecast
        inputs={{
          dailyHistory: history,
          activeListings: 3,
          totalListings: 3,
          conversionRate: 0.05,
          refundRate: 0.35,
        }}
      />
    );
    const warnings = screen.getAllByTestId("forecast-warning");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].textContent).toMatch(/refund/i);
  });

  it("exposes data-confidence and data-insufficient for visual testing", () => {
    const history = generateDeterministicHistory(30, 20, 0, 0);
    const { container } = render(
      <RevenueForecast
        inputs={{
          dailyHistory: history,
          activeListings: 5,
          totalListings: 5,
          conversionRate: 0.04,
          refundRate: 0.02,
        }}
      />
    );
    const el = container.querySelector('[data-testid="revenue-forecast"]')!;
    expect(el.getAttribute("data-confidence")).toBe("high");
    expect(el.getAttribute("data-insufficient")).toBe("false");
  });
});
