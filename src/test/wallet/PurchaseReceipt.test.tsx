import React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../render";
import { PurchaseReceipt } from "../../components/prompts/PurchaseReceipt";

const mockPromptDetail = {
  title: "A cool prompt",
  creator: "GABCDE1234567890",
  priceStroops: 100000000n, // 10 XLM
  contentHash: "abcdef1234567890",
};

describe("PurchaseReceipt Component", () => {
  it("renders a confirmed receipt correctly", () => {
    renderWithProviders(
      <PurchaseReceipt
        promptDetail={mockPromptDetail}
        itemId="123"
        walletAddress="GBUYER..."
        txHash="test-tx-hash-123456"
        isPendingIndexing={false}
      />
    );

    // Should show confirmed state
    expect(screen.getByText(/Purchase Receipt/i)).toBeInTheDocument();
    
    // Shows title, creator, amount, fee
    expect(screen.getByText("A cool prompt")).toBeInTheDocument();
    expect(screen.getByText("10 XLM")).toBeInTheDocument();
    expect(screen.getByText("0.5 XLM")).toBeInTheDocument(); // 5% fee
    
    // Shows transaction hash
    const txLink = screen.getByText(/test-tx-hash-123/);
    expect(txLink).toBeInTheDocument();
    expect(txLink.closest("a")).toHaveAttribute("href", expect.stringContaining("test-tx-hash-123456"));
    
    // Shows copy buttons
    expect(screen.getByTestId("copy-tx-hash")).toBeInTheDocument();
    expect(screen.getByTestId("copy-prompt-ID")).toBeInTheDocument();
    expect(screen.getByTestId("copy-content-hash")).toBeInTheDocument();
  });

  it("renders a delayed indexing receipt correctly without looking like a failure", () => {
    renderWithProviders(
      <PurchaseReceipt
        promptDetail={mockPromptDetail}
        itemId="123"
        walletAddress="GBUYER..."
        txHash="test-tx-hash-789"
        isPendingIndexing={true}
      />
    );

    // Should show pending indexing state
    expect(screen.getByText(/Pending Indexing.../i)).toBeInTheDocument();
    expect(screen.getByText(/successful on the Stellar network/i)).toBeInTheDocument();
    
    // Shouldn't look like an error
    expect(screen.queryByText(/Error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed/i)).not.toBeInTheDocument();

    // Still shows the details and tx hash so user has proof
    const txLink = screen.getByText(/test-tx-hash-789/);
    expect(txLink).toBeInTheDocument();
  });
});
