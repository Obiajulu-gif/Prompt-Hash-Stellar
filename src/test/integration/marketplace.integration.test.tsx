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
  PromptHashClient: {
    checkAccess: (...args: unknown[]) => hasAccessMock(...args),
    purchasePrompt: (...args: unknown[]) => buyPromptAccessMock(...args),
  },
}));

vi.mock("@/lib/prompts/unlock", () => ({
  unlockPrompt: (...args: unknown[]) => unlockPromptContentMock(...args),
  unlockPromptContent: (...args: unknown[]) => unlockPromptContentMock(...args),
}));

describe("marketplace purchase and unlock integration coverage", () => {
  it("shows only active listings on the marketplace grid", async () => {
    const activePrompt = makePrompt({
      id: 3n,
      title: "Active marketplace listing",
      active: true,
    });
    const inactivePrompt = makePrompt({
      id: 4n,
      title: "Inactive delisted prompt",
      active: false,
    });

    getAllPromptsMock.mockResolvedValue([activePrompt, inactivePrompt]);
    hasAccessMock.mockResolvedValue(false);

    renderWithProviders(
      <FetchAllPrompts
        selectedCategory=""
        priceRange={[0, 25]}
        searchQuery=""
        sortBy="recent"
      />,
    );

    expect(await screen.findByText("Active marketplace listing")).toBeInTheDocument();
    expect(screen.queryByText("Inactive delisted prompt")).not.toBeInTheDocument();
  });

  it("searches prompt descriptions as well as titles", async () => {
    const prompt = makePrompt({
      id: 5n,
      title: "Hidden narrative prompt",
      previewText: "Build a complete story arc with three plot twists.",
      tags: ["Storytelling"],
    });
    const otherPrompt = makePrompt({
      id: 6n,
      title: "Sales operations overview",
      previewText: "Manage sales staffing and quotas.",
      tags: ["Sales"],
    });

    getAllPromptsMock.mockResolvedValue([prompt, otherPrompt]);
    hasAccessMock.mockResolvedValue(false);

    renderWithProviders(
      <FetchAllPrompts
        selectedCategory=""
        selectedTag=""
        priceRange={[0, 25]}
        searchQuery="story arc"
        sortBy="recent"
      />,
    );

    expect(await screen.findByText("Hidden narrative prompt")).toBeInTheDocument();
    expect(screen.queryByText("Sales operations overview")).not.toBeInTheDocument();
  });

  it("filters listings by selected tag", async () => {
    const prompt = makePrompt({
      id: 9n,
      title: "Taggable prompt",
      previewText: "A prompt with useful metadata.",
      tags: ["AI"],
    });
    const otherPrompt = makePrompt({
      id: 10n,
      title: "Different prompt",
      previewText: "Another listing.",
      tags: ["Sales"],
    });

    getAllPromptsMock.mockResolvedValue([prompt, otherPrompt]);
    hasAccessMock.mockResolvedValue(false);

    renderWithProviders(
      <FetchAllPrompts
        selectedCategory=""
        selectedTag="AI"
        priceRange={[0, 25]}
        searchQuery=""
        sortBy="recent"
      />,
    );

    expect(await screen.findByText("Taggable prompt")).toBeInTheDocument();
    expect(screen.queryByText("Different prompt")).not.toBeInTheDocument();
  });

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
      decryptedContent: "Unlocked private prompt body.",
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
        selectedTag=""
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

    // Click prompt title or the card itself to open the modal dialog
    const cardButton = await screen.findByRole("button", { name: `Open ${prompt.title}` });
    await userEvent.click(cardButton);

    const dialog = await screen.findByRole("dialog", {
      name: /acquire license/i,
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: /confirm & purchase/i }),
    );

    await waitFor(() => {
      expect(buyPromptAccessMock).toHaveBeenCalledWith(
        "7",
        "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789",
      );
    });

    expect(unlockPromptContentMock).toHaveBeenCalledWith(
      "7",
      "purchase-hash",
      signMessage,
      "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789",
    );
    expect(
      await within(dialog).findByText("Unlocked private prompt body."),
    ).toBeInTheDocument();

    await waitFor(() => {
      // PromptCard shows "Owned" button now
      expect(
        screen.getAllByRole("button", { name: /owned/i }),
      ).toHaveLength(1);
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
        decryptedContent: "Recovered prompt plaintext.",
      });

    const signMessage = vi.fn().mockResolvedValue({
      signedMessage: "signed-message",
    });

    renderWithProviders(
      <FetchAllPrompts
        selectedCategory=""
        selectedTag=""
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
    
    // Click the owned prompt card to open the modal
    const cardButton = await screen.findByRole("button", { name: `Open ${prompt.title}` });
    await userEvent.click(cardButton);

    const dialog = await screen.findByRole("dialog", {
      name: /acquire license/i,
    });
    const unlockButton = within(dialog).getByRole("button", {
      name: /decrypt content/i,
    });

    await userEvent.click(unlockButton);
    expect(
      await within(dialog).findByText("Unlock service temporarily unavailable."),
    ).toBeInTheDocument();

    const freshUnlockButton = within(dialog).getByRole("button", {
      name: /decrypt content/i,
    });
    await userEvent.click(freshUnlockButton);
    expect(
      await within(dialog).findByText("Recovered prompt plaintext."),
    ).toBeInTheDocument();
  });
});
