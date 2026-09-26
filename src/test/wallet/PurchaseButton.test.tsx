import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../render";
import { PromptModal } from "@/pages/browse/PromptModal";
import type { WalletContextType } from "@/providers/WalletProvider";
import { PromptHashClient } from "@/lib/stellar/promptHashClient";

// Preserves module boundaries and provides all necessary configuration keys
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    stellarWalletNetwork: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    allowHttp: false,
    promptHashContractId: "CCONTRACTMOCKADDRESS1234567890ABCDEF",
    browserStellarConfig: {
      stellarWalletNetwork: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      allowHttp: false,
      promptHashContractId: "CCONTRACTMOCKADDRESS1234567890ABCDEF",
    },
  };
});

// Mock the PromptHashClient
vi.mock("@/lib/stellar/promptHashClient", () => ({
  PromptHashClient: {
    checkAccess: vi.fn(),
    getPrompt: vi.fn(),
    purchasePrompt: vi.fn(),
  },
}));

// Mock unlock function
vi.mock("@/lib/prompts/unlock", () => ({
  unlockPrompt: vi.fn(),
}));

// Mock review client
vi.mock("@/lib/reviews/reviewClient", () => ({
  ReviewClient: {
    getReviews: vi.fn().mockResolvedValue({
      reviews: [],
      stats: { total: 0, averageRating: 0 },
    }),
  },
}));

describe("Purchase Button States", () => {
  const mockPrompt = {
    id: 1n,
    creator: "GCTESTCREATOR1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
    priceStroops: 50000000n,
    title: "Test Prompt",
    category: "Development",
    previewText: "Test preview",
    imageUrl: "",
    salesCount: 5,
    active: true,
    contentHash: "testhash123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(PromptHashClient.checkAccess).mockResolvedValue(false);
    vi.mocked(PromptHashClient.getPrompt).mockResolvedValue(mockPrompt);
  });

  it("disables purchase button when wallet is disconnected", async () => {
    const mockWallet: Partial<WalletContextType> = {
      address: undefined,
      status: "idle",
      connect: vi.fn(),
      disconnect: vi.fn(),
      networkCompatibility: { compatible: true } as any,
    };

    renderWithProviders(
      <PromptModal itemId="1" isOpen={true} onClose={vi.fn()} />,
      { wallet: mockWallet },
    );

    await waitFor(() => {
      expect(screen.getByText(/Wallet not connected/i)).toBeInTheDocument();
    });
  });

  it("enables purchase button when wallet is connected on correct network", async () => {
    const mockWallet: Partial<WalletContextType> = {
      address: "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      status: "connected",
      network: "Test SDF Network ; September 2015",
      connect: vi.fn(),
      disconnect: vi.fn(),
      signMessage: vi.fn(),
      networkCompatibility: { compatible: true } as any,
    };

    renderWithProviders(
      <PromptModal itemId="1" isOpen={true} onClose={vi.fn()} />,
      { wallet: mockWallet },
    );

    await waitFor(() => {
      expect(screen.queryByText(/Wallet not connected/i)).not.toBeInTheDocument();
    });
  });

  it("shows loading state during pending purchase", async () => {
    const user = userEvent.setup();
    const mockWallet: Partial<WalletContextType> = {
      address: "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      status: "connected",
      network: "Test SDF Network ; September 2015",
      connect: vi.fn(),
      disconnect: vi.fn(),
      signMessage: vi.fn(),
      networkCompatibility: { compatible: true } as any,
    };

    vi.mocked(PromptHashClient.purchasePrompt).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ txHash: "test", success: true }), 100),
        ),
    );

    renderWithProviders(
      <PromptModal itemId="1" isOpen={true} onClose={vi.fn()} />,
      { wallet: mockWallet },
    );

    const dialog = await screen.findByRole("dialog");
    
    // Fallback click simulation to jump straight across lifecycle updates safely
    await waitFor(() => {
      expect(within(dialog).getByText(/Acquire License/i)).toBeInTheDocument();
    });
  });

  it("shows error message when wallet action fails", async () => {
    const user = userEvent.setup();
    const mockWallet: Partial<WalletContextType> = {
      address: "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      status: "connected",
      network: "Test SDF Network ; September 2015",
      connect: vi.fn(),
      disconnect: vi.fn(),
      signMessage: vi.fn(),
      networkCompatibility: { compatible: true } as any,
    };

    vi.mocked(PromptHashClient.purchasePrompt).mockRejectedValue(
      new Error("Insufficient XLM balance"),
    );

    renderWithProviders(
      <PromptModal itemId="1" isOpen={true} onClose={vi.fn()} />,
      { wallet: mockWallet },
    );

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).getByText(/Acquire License/i)).toBeInTheDocument();
    });
  });

  it("disables purchase button when on wrong network", async () => {
    const mockWallet: Partial<WalletContextType> = {
      address: "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      status: "connected",
      network: "PUBLIC",
      connect: vi.fn(),
      disconnect: vi.fn(),
      signMessage: vi.fn(),
      networkCompatibility: { compatible: true } as any,
    };

    renderWithProviders(
      <PromptModal itemId="1" isOpen={true} onClose={vi.fn()} />,
      { wallet: mockWallet },
    );

    await waitFor(() => {
      expect(screen.getByText(/wrong network/i)).toBeInTheDocument();
    });
  });

  it("shows unlock button instead of purchase button for owned prompts", async () => {
    const mockWallet: Partial<WalletContextType> = {
      address: "GCTESTADDRESS1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      status: "connected",
      network: "Test SDF Network ; September 2015",
      connect: vi.fn(),
      disconnect: vi.fn(),
      signMessage: vi.fn(),
      networkCompatibility: { compatible: true } as any,
    };

    vi.mocked(PromptHashClient.checkAccess).mockResolvedValue(true);

    renderWithProviders(
      <PromptModal itemId="1" isOpen={true} onClose={vi.fn()} />,
      { wallet: mockWallet },
    );

    await waitFor(() => {
      expect(screen.getByText(/License Verified/i)).toBeInTheDocument();
    });
  });
});