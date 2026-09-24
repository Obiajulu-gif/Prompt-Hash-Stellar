import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MultiCurrencyQuoteBreakdown } from "../../components/checkout/MultiCurrencyQuoteBreakdown";

describe("MultiCurrencyQuoteBreakdown Component (#760)", () => {
  const defaultProps = {
    promptTitle: "Awesome AI Prompt",
    promptId: "101",
    basePriceStroops: 100_000_000n, // 10 XLM
    buyerAddress: "GABCD1234567890",
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders asset selector buttons, rate, fees, and initial active quote breakdown", () => {
    const onQuoteChange = vi.fn();
    render(<MultiCurrencyQuoteBreakdown {...defaultProps} onQuoteChange={onQuoteChange} />);

    // Asset buttons
    expect(screen.getByRole("button", { name: "XLM" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "USDC" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EURC" })).toBeInTheDocument();

    // Amount breakdown
    expect(screen.getByText("Prompt Price (Awesome AI Prompt)")).toBeInTheDocument();
    expect(screen.getByText("Total Quoted Settlement")).toBeInTheDocument();
    expect(screen.getAllByText(/10 XLM/i).length).toBeGreaterThan(0);

    expect(onQuoteChange).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteAsset: "XLM",
        promptId: "101",
      }),
      true // isValid
    );
  });

  it("switches asset when USDC tab is selected and updates rate & breakdown", () => {
    const onQuoteChange = vi.fn();
    render(<MultiCurrencyQuoteBreakdown {...defaultProps} onQuoteChange={onQuoteChange} />);

    const usdcBtn = screen.getByRole("button", { name: "USDC" });
    fireEvent.click(usdcBtn);

    expect(screen.getByText(/1 XLM = 0.12 USDC/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1.2 USDC/i).length).toBeGreaterThan(0);

    expect(onQuoteChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        quoteAsset: "USDC",
      }),
      true
    );
  });

  it("transitions to expired state when countdown reaches zero and invokes callback", () => {
    const onQuoteChange = vi.fn();
    render(<MultiCurrencyQuoteBreakdown {...defaultProps} onQuoteChange={onQuoteChange} />);

    // Fast-forward timer by 61 seconds (TTL is 60s)
    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(screen.getByText(/Quote Expired/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Expired quotes cannot be used for purchase settlement/i)
    ).toBeInTheDocument();

    expect(onQuoteChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        quoteAsset: "XLM",
      }),
      false // isValid = false
    );
  });

  it("refreshes quote when Refresh Quote button is clicked", () => {
    const onQuoteChange = vi.fn();
    render(<MultiCurrencyQuoteBreakdown {...defaultProps} onQuoteChange={onQuoteChange} />);

    // Fast-forward past expiry
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText(/Quote Expired/i)).toBeInTheDocument();

    // Click Refresh Quote Now
    const refreshBtn = screen.getByRole("button", { name: /Refresh Quote Now/i });
    fireEvent.click(refreshBtn);

    // Quote should be active again
    expect(screen.queryByText(/Quote Expired/i)).not.toBeInTheDocument();
    expect(onQuoteChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        quoteAsset: "XLM",
      }),
      true
    );
  });
});
