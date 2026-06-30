import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import PromptDetailPage from "@/pages/prompts/PromptDetailPage";
import { renderWithProviders } from "@/test/render";
import { getPrompt, PromptHashClient } from "@/lib/stellar/promptHashClient";
import { unlockPrompt } from "@/lib/prompts/unlock";

const prompt = {
  id: 297n,
  creator: "GCREATORACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
  priceStroops: 75_0000000n,
  title: "Ownership-aware launch prompt",
  category: "Marketing",
  previewText: "Preview text for buyers before checkout.",
  description: "Detailed prompt guidance with usage notes.",
  tags: ["launch", "copy"],
  imageUrl: "",
  salesCount: 9,
  active: true,
  contentHash: "hash_297",
  revision: 2,
};

const mocked = vi.hoisted(() => ({
  reviews: {
    reviews: [
      {
        id: "review-1",
        promptId: "297",
        userAddress: "GBUYERACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567",
        rating: 5,
        text: "Clear and immediately usable.",
        createdAt: Date.now(),
        verified: true,
      },
    ],
    stats: {
      total: 1,
      averageRating: 5,
      distribution: { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 },
    },
  },
}));

vi.mock("@/lib/stellar/browserConfig", () => ({
  browserStellarConfig: {
    rpcUrl: "https://stellar.test/rpc",
    networkPassphrase: "Test SDF Network ; September 2015",
    allowHttp: false,
    promptHashContractId: "prompt-hash-contract",
    nativeAssetContractId: "native-asset-contract",
    simulationAccount: "GSIMULATIONACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  },
}));

vi.mock("@/lib/stellar/promptHashClient", () => ({
  getPrompt: vi.fn(),
  PromptHashClient: {
    checkAccess: vi.fn(),
    purchasePrompt: vi.fn(),
  },
}));

vi.mock("@/lib/prompts/unlock", () => ({
  unlockPrompt: vi.fn(),
}));

vi.mock("@/lib/reviews/reviewClient", () => ({
  ReviewClient: {
    getReviews: vi.fn().mockResolvedValue(mocked.reviews),
    submitReview: vi.fn(),
  },
}));

vi.mock("@/components/navigation", () => ({
  Navigation: () => <nav aria-label="Main navigation" />,
}));

vi.mock("@/components/footer", () => ({
  Footer: () => <footer />,
}));

describe("Issue #297 prompt detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(PromptHashClient.checkAccess).mockResolvedValue(false);
    vi.mocked(PromptHashClient.purchasePrompt).mockResolvedValue({
      txHash: "purchase_hash_297",
      approvalTxHash: "approval_hash_297",
      success: true,
      confirmedAtLedger: 123,
    });
    vi.mocked(unlockPrompt).mockResolvedValue({
      decryptedContent: "Unlocked paid prompt body.",
      plaintext: "Unlocked paid prompt body.",
    });
    vi.mocked(getPrompt).mockResolvedValue(prompt);
  });

  it("renders review insights and sticky licensing actions", async () => {
    renderPromptDetail();

    expect(
      await screen.findByRole("heading", {
        name: "Ownership-aware launch prompt",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Review Insights")).toBeInTheDocument();
    expect(screen.getByText("License price")).toBeInTheDocument();
    expect(screen.getByText("Standard wallet license")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /report/i })).toBeInTheDocument();
  });

  it("submits a real XLM purchase request with signer/config and confirms access", async () => {
    const user = userEvent.setup();
    const signTransaction = vi.fn();

    renderPromptDetail({
      wallet: {
        address: "GBUYERACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567",
        status: "connected",
        network: "Test SDF Network ; September 2015",
        signTransaction,
        signMessage: vi.fn(),
      },
    });

    const purchaseButton = await screen.findByRole("button", {
      name: /pay with xlm/i,
    });
    await user.click(purchaseButton);

    await waitFor(() => {
      expect(PromptHashClient.purchasePrompt).toHaveBeenCalledWith(
        "297",
        "GBUYERACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567",
        expect.objectContaining({
          config: expect.objectContaining({
            promptHashContractId: "prompt-hash-contract",
            nativeAssetContractId: "native-asset-contract",
          }),
          signer: { signTransaction },
        }),
      );
    });

    expect(
      await screen.findByText(/license verified/i),
    ).toBeInTheDocument();
    expect(screen.getByText("purchase_hash_297")).toBeInTheDocument();
  });

  it("unlocks token-gated content only after on-chain access is detected", async () => {
    const user = userEvent.setup();
    vi.mocked(PromptHashClient.checkAccess).mockResolvedValue(true);
    const signMessage = vi.fn().mockResolvedValue({ signedMessage: "sig" });

    renderPromptDetail({
      wallet: {
        address: "GBUYERACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567",
        status: "connected",
        network: "Test SDF Network ; September 2015",
        signMessage,
      },
    });

    const decryptButton = await screen.findByRole("button", {
      name: /decrypt content/i,
    });
    await user.click(decryptButton);

    expect(await screen.findByText("Unlocked Content")).toBeInTheDocument();
    expect(screen.getByText("Unlocked paid prompt body.")).toBeInTheDocument();
    expect(unlockPrompt).toHaveBeenCalledWith(
      "297",
      "existing",
      signMessage,
      "GBUYERACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567",
    );
  });

  it("shows improved purchase recovery messaging", async () => {
    const user = userEvent.setup();
    vi.mocked(PromptHashClient.purchasePrompt).mockRejectedValue(
      new Error("op_underfunded"),
    );

    renderPromptDetail({
      wallet: {
        address: "GBUYERACCOUNT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567",
        status: "connected",
        network: "Test SDF Network ; September 2015",
        signTransaction: vi.fn(),
      },
    });

    await user.click(
      await screen.findByRole("button", { name: /pay with xlm/i }),
    );

    expect(
      await screen.findByText(/does not have enough xlm/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/add funds to your wallet/i),
    ).toBeInTheDocument();
  });
});

function renderPromptDetail(options = {}) {
  return renderWithProviders(
    <Routes>
      <Route path="/prompts/:id" element={<PromptDetailPage />} />
    </Routes>,
    { route: "/prompts/297", ...options },
  );
}
