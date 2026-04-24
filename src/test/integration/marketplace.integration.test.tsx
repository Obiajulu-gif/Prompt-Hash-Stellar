import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import FetchAllPrompts from "@/pages/browse/FetchAllPrompts";
import { makePrompt } from "@/test/fixtures/prompts";
import { renderWithProviders } from "@/test/render";

const getAllPromptsMock = vi.fn();
const hasAccessMock = vi.fn();
const buyPromptAccessMock = vi.fn();
const unlockPromptContentMock = vi.fn();

vi.mock("@/lib/stellar/browserConfig", () => ({
  browserStellarConfig: {
    rpcUrl: "https://stellar.test/rpc",
    networkPassphrase: "Test SDF Network ; September 2015",
    allowHttp: false,
    promptHashContractId: "prompt-hash-contract",
    nativeAssetContractId: "native-asset-contract",
    simulationAccount: "GTESTSIMULATIONACCOUNT1234567890ABCDEFGH1234567890ABCD",
  },
}));

vi.mock("@/lib/stellar/promptHashClient", () => ({
  getAllPrompts: (...args: unknown[]) => getAllPromptsMock(...args),
  hasAccess: (...args: unknown[]) => hasAccessMock(...args),
  buyPromptAccess: (...args: unknown[]) => buyPromptAccessMock(...args),
}));

vi.mock("@/lib/prompts/unlock", () => ({
  unlockPromptContent: (...args: unknown[]) => unlockPromptContentMock(...args),
}));

describe("marketplace purchase and unlock integration coverage", () => {
  it("buys access, unlocks content, and refreshes the marketplace access state", async () => {
    const prompt = makePrompt({
      id: 7n,
      title: "Conversion copy engine",
      previewText: "Public preview for a paid prompt.",
      priceStroops: 5_0000000n,
    });
    let hasAccessState = false;

    getAllPromptsMock.mockResolvedValue([prompt]);
    hasAccessMock.mockImplementation(async () => hasAccessState);
    buyPromptAccessMock.mockImplementation(async () => {
      hasAccessState = true;
      return { txHash: "purchase-hash" };
    });
    unlockPromptContentMock.mockResolvedValue({
      promptId: prompt.id.toString(),
      title: prompt.title,
      contentHash: prompt.contentHash,
      plaintext: "Unlocked private prompt body.",
    });

    const signTransaction = vi.fn().mockResolvedValue({
      signedTxXdr: "signed-transaction-xdr",
    });
    const signMessage = vi.fn().mockResolvedValue({
      signedMessage: "signed-message",
    });

    renderWithProviders(
      <FetchAllPrompts
        selectedCategory=""
        priceRange={[0, 25]}
        searchQuery=""
        sortBy="recent"
      />,
      {
        wallet: {
          address: "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789",
          signTransaction,
          signMessage,
        },
      },
    );

    await screen.findByText(prompt.title);

    const cardButton = await screen.findByRole("button", { name: /^buy access$/i });
    await userEvent.click(cardButton);

    const dialog = await screen.findByRole("dialog", {
      name: prompt.title,
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: /^buy access$/i }),
    );

    await waitFor(() => {
      expect(buyPromptAccessMock).toHaveBeenCalledWith(
        expect.anything(),
        { signTransaction },
        "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789",
        7n,
        5_0000000n,
      );
    });

    expect(unlockPromptContentMock).toHaveBeenCalledWith(
      "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789",
      7n,
      signMessage,
    );
    expect(
      await within(dialog).findByText("Unlocked private prompt body."),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /view full prompt/i }),
      ).toHaveLength(2);
    });
  });

  it("recovers cleanly after an unlock failure and allows a successful retry", async () => {
    const prompt = makePrompt({
      id: 8n,
      title: "Retention playbook",
    });

    getAllPromptsMock.mockResolvedValue([prompt]);
    hasAccessMock.mockResolvedValue(true);
    unlockPromptContentMock
      .mockRejectedValueOnce(new Error("Unlock service temporarily unavailable."))
      .mockResolvedValueOnce({
        promptId: prompt.id.toString(),
        title: prompt.title,
        contentHash: prompt.contentHash,
        plaintext: "Recovered prompt plaintext.",
      });

    const signMessage = vi.fn().mockResolvedValue({
      signedMessage: "signed-message",
    });

    renderWithProviders(
      <FetchAllPrompts
        selectedCategory=""
        priceRange={[0, 25]}
        searchQuery=""
        sortBy="recent"
      />,
      {
        wallet: {
          address: "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789",
          signMessage,
        },
      },
    );

    await screen.findByText(prompt.title);
    await userEvent.click(
      await screen.findByRole("button", { name: /^view full prompt$/i }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: prompt.title,
    });
    const unlockButton = within(dialog).getByRole("button", {
      name: /^view full prompt$/i,
    });

    await userEvent.click(unlockButton);
    expect(
      await within(dialog).findByText("Unlock service temporarily unavailable."),
    ).toBeInTheDocument();

    await userEvent.click(unlockButton);
    expect(
      await within(dialog).findByText("Recovered prompt plaintext."),
    ).toBeInTheDocument();
  });
});
