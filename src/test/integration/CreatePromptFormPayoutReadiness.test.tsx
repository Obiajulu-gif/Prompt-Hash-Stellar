/**
 * Integration tests for CreatePromptForm with payout readiness validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../render";
import { CreatePromptForm } from "@/pages/sell/CreatePromptForm";

// Mock all the required modules
vi.mock("@/hooks/usePayoutReadiness");
vi.mock("@/hooks/useDraftAutoSave");
vi.mock("@/lib/env", () => ({
  unlockPublicKey: "mock-unlock-public-key",
  stellarWalletNetwork: "Test SDF Network ; September 2015",
  stellarNetwork: "TESTNET",
}));
vi.mock("@/lib/stellar/browserConfig", () => ({
  browserStellarConfig: {
    promptHashContractId: "mock-contract-id",
  },
}));
vi.mock("@/lib/stellar/promptHashClient", () => ({
  PromptHashClient: { createPrompt: vi.fn() },
  findPromptByContentHash: vi.fn(),
  getPrompt: vi.fn(),
}));
vi.mock("@/lib/ipfs", () => ({
  isIpfsUploadConfigured: vi.fn(() => false),
}));
vi.mock("@/components/sell/CreatorOnboarding", () => ({
  CreatorOnboarding: () => <div data-testid="creator-onboarding">Creator Onboarding</div>,
}));
vi.mock("@/components/sell/ListingQualityChecklist", () => ({
  ListingQualityChecklist: () => <div data-testid="quality-checklist">Quality Checklist</div>,
  buildChecklistItems: vi.fn().mockReturnValue([]),
}));
vi.mock("@/components/sell/PayoutReadinessBanner", () => ({
  PayoutReadinessBanner: ({ className }: { className?: string }) => (
    <div data-testid="payout-readiness-banner" className={className}>
      Payout Readiness Banner
    </div>
  ),
}));

import { usePayoutReadiness } from "@/hooks/usePayoutReadiness";
import { useDraftAutoSave } from "@/hooks/useDraftAutoSave";
import { isIpfsUploadConfigured } from "@/lib/ipfs";

const mockUsePayoutReadiness = vi.mocked(usePayoutReadiness);
const mockUseDraftAutoSave = vi.mocked(useDraftAutoSave);
const mockIsIpfsUploadConfigured = vi.mocked(isIpfsUploadConfigured);

describe("CreatePromptForm - Payout Readiness Integration", () => {
  const mockAddress = "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock default returns
    mockUseDraftAutoSave.mockReturnValue({
      draftRestored: false,
      lastSavedAt: null,
      discardDraft: vi.fn(),
      saveNow: vi.fn(),
      conflict: null,
      resolveConflict: vi.fn(),
      sessionGuard: null,
      resolveSessionGuard: vi.fn(),
      canPublish: true,
      draftOwnerAddress: "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      draftNetwork: undefined,
    });

    mockIsIpfsUploadConfigured.mockReturnValue(false);
  });

  it("should render PayoutReadinessBanner component", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: true,
        checks: [],
        blockers: [],
        warnings: [],
      },
      isLoading: false,
      isReady: true,
      shouldBlock: false,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<CreatePromptForm />, {
      wallet: { address: mockAddress, signTransaction: vi.fn() },
    });

    expect(screen.getByTestId("payout-readiness-banner")).toBeInTheDocument();
  });

  it("should show normal submit button when payout is ready", async () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: true,
        checks: [],
        blockers: [],
        warnings: [],
      },
      isLoading: false,
      isReady: true,
      shouldBlock: false,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<CreatePromptForm />, {
      wallet: { address: mockAddress, signTransaction: vi.fn() },
    });

    const submitButton = screen.getByRole("button", { name: /create prompt listing/i });
    expect(submitButton).toBeInTheDocument();
    expect(submitButton).not.toBeDisabled();
  });

  it("should disable submit button when payout setup is incomplete", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: false,
        checks: [],
        blockers: ["Complete your profile"],
        warnings: [],
      },
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: ["Complete your profile"],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<CreatePromptForm />, {
      wallet: { address: mockAddress, signTransaction: vi.fn() },
    });

    const submitButton = screen.getByRole("button", { name: /complete payout setup to publish/i });
    expect(submitButton).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
  });

  it("should show loading button when payout readiness is loading", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: null,
      isLoading: true,
      isReady: false,
      shouldBlock: true,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<CreatePromptForm />, {
      wallet: { address: mockAddress, signTransaction: vi.fn() },
    });

    expect(screen.getByText(/checking payout setup/i)).toBeInTheDocument();
  });

  it("should block form submission when payout setup is incomplete", async () => {
    const user = userEvent.setup();
    const mockSignTransaction = vi.fn();

    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: false,
        checks: [],
        blockers: ["Complete your profile", "Set up payout address"],
        warnings: [],
      },
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: ["Complete your profile", "Set up payout address"],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<CreatePromptForm />, {
      wallet: { address: mockAddress, signTransaction: mockSignTransaction },
    });

    // Fill out the form
    const titleInput = screen.getByLabelText(/title/i);
    const categorySelect = screen.getByRole("combobox", { name: /category/i });
    const previewTextarea = screen.getByLabelText(/preview text/i);
    const priceInput = screen.getByLabelText(/price in xlm/i);
    const promptTextarea = screen.getByLabelText(/full prompt/i);

    await user.type(titleInput, "Test Prompt");
    await user.click(categorySelect);
    await user.click(screen.getByRole("option", { name: /marketing/i }));
    await user.type(previewTextarea, "This is a test preview text for the prompt");
    await user.type(priceInput, "2.5");
    await user.type(promptTextarea, "This is the full prompt content that will be encrypted");

    // Try to submit - should be blocked
    const submitButton = screen.getByRole("button", { name: /complete payout setup to publish/i });
    expect(submitButton).toBeDisabled();

    // Even if we force click, the form submission should be blocked
    // This is tested by the submit handler logic
  });

  it("should allow form submission when payout setup is complete", async () => {
    const user = userEvent.setup();
    const mockSignTransaction = vi.fn();
    
    // Mock successful payout readiness
    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: true,
        checks: [
          {
            id: "wallet-connection",
            name: "Wallet Connection",
            description: "Valid Stellar wallet must be connected",
            status: "pass",
            message: "Wallet connected successfully",
          },
          {
            id: "payout-destination",
            name: "Payout Destination",
            description: "Configured address where earnings will be sent",
            status: "pass",
            message: "Payout address configured successfully",
          },
          {
            id: "creator-profile",
            name: "Creator Profile",
            description: "Complete profile builds buyer trust",
            status: "pass",
            message: "Creator profile is complete and professional",
          },
          {
            id: "settlement-readiness",
            name: "Settlement Readiness",
            description: "Sufficient XLM balance for transaction fees",
            status: "pass",
            message: "Sufficient balance for transaction fees",
          },
        ],
        blockers: [],
        warnings: [],
      },
      isLoading: false,
      isReady: true,
      shouldBlock: false,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<CreatePromptForm />, {
      wallet: { address: mockAddress, signTransaction: mockSignTransaction },
    });

    // Fill out the minimum required form fields
    const imageUrlInput = screen.getByLabelText(/image url/i);
    const titleInput = screen.getByLabelText(/title/i);
    const categorySelect = screen.getByRole("combobox", { name: /category/i });
    const previewTextarea = screen.getByLabelText(/preview text/i);
    const priceInput = screen.getByLabelText(/price in xlm/i);
    const promptTextarea = screen.getByLabelText(/full prompt/i);

    await user.type(imageUrlInput, "https://example.com/image.png");
    await user.type(titleInput, "Test Prompt");
    await user.click(categorySelect);
    await user.click(screen.getByRole("option", { name: /marketing/i }));
    await user.type(previewTextarea, "This is a test preview text for the prompt");
    await user.type(priceInput, "2.5");
    await user.type(promptTextarea, "This is the full prompt content that will be encrypted");

    // Submit button should be enabled (though other validation might still block)
    const submitButton = screen.getByRole("button", { name: /create prompt listing/i });
    expect(submitButton).toBeInTheDocument();
    expect(submitButton).not.toBeDisabled();
  });

  it("should handle payout readiness check errors gracefully", () => {
    mockUsePayoutReadiness.mockReturnValue({
      readiness: null,
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    renderWithProviders(<CreatePromptForm />, {
      wallet: { address: mockAddress, signTransaction: vi.fn() },
    });

    // Should still render the form but with blocking state
    const submitButton = screen.getByRole("button", { name: /complete payout setup to publish/i });
    expect(submitButton).toBeDisabled();
  });

  it("should show appropriate button text for different payout states", () => {
    // Test loading state
    mockUsePayoutReadiness.mockReturnValue({
      readiness: null,
      isLoading: true,
      isReady: false,
      shouldBlock: true,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    const { rerender } = renderWithProviders(<CreatePromptForm />, {
      wallet: { address: mockAddress, signTransaction: vi.fn() },
    });

    expect(screen.getByText(/checking payout setup/i)).toBeInTheDocument();

    // Test blocking state
    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: false,
        checks: [],
        blockers: ["Setup incomplete"],
        warnings: [],
      },
      isLoading: false,
      isReady: false,
      shouldBlock: true,
      blockingIssues: ["Setup incomplete"],
      refreshReadiness: vi.fn(),
    });

    rerender(<CreatePromptForm />);
    expect(screen.getByText(/complete payout setup to publish/i)).toBeInTheDocument();

    // Test ready state
    mockUsePayoutReadiness.mockReturnValue({
      readiness: {
        isReady: true,
        checks: [],
        blockers: [],
        warnings: [],
      },
      isLoading: false,
      isReady: true,
      shouldBlock: false,
      blockingIssues: [],
      refreshReadiness: vi.fn(),
    });

    rerender(<CreatePromptForm />);
    expect(screen.getByText(/create prompt listing/i)).toBeInTheDocument();
  });
});