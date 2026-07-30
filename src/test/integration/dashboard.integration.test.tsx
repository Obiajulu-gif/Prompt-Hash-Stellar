import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MyPrompts from "@/pages/sell/MyPrompts";
import { makePrompt } from "@/test/fixtures/prompts";
import { renderWithProviders } from "@/test/render";

const getPromptsByCreatorMock = vi.fn();
const getPromptsByBuyerMock = vi.fn();
const updatePromptPriceMock = vi.fn();
const setPromptSaleStatusMock = vi.fn();
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
  getPromptsByCreator: (...args: unknown[]) => getPromptsByCreatorMock(...args),
  getPromptsByBuyer: (...args: unknown[]) => getPromptsByBuyerMock(...args),
  updatePromptPrice: (...args: unknown[]) => updatePromptPriceMock(...args),
  setPromptSaleStatus: (...args: unknown[]) => setPromptSaleStatusMock(...args),
}));

vi.mock("@/lib/prompts/unlock", () => ({
  unlockPromptContent: (...args: unknown[]) => unlockPromptContentMock(...args),
}));

describe("creator dashboard refresh integration coverage", () => {
  it("refreshes the created prompts dashboard after a price mutation", async () => {
    const basePrompt = makePrompt({
      id: 21n,
      title: "Revenue memo builder",
      priceStroops: 2_0000000n,
    });
    let currentCreatedPrompts = [basePrompt];

    getPromptsByCreatorMock.mockImplementation(async () => currentCreatedPrompts);
    getPromptsByBuyerMock.mockResolvedValue([]);
    updatePromptPriceMock.mockImplementation(async () => {
      currentCreatedPrompts = [
        {
          ...basePrompt,
          priceStroops: 3_5000000n,
        },
      ];
      return { txHash: "update-hash" };
    });

    const signTransaction = vi.fn().mockResolvedValue({
      signedTxXdr: "signed-transaction-xdr",
    });

    renderWithProviders(<MyPrompts />, {
      wallet: {
        address: "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
        signTransaction,
      },
    });

    expect(await screen.findByText("Revenue memo builder")).toBeInTheDocument();
    expect(screen.getByText("2 XLM")).toBeInTheDocument();

    const priceInput = screen.getByLabelText("Price in XLM for Revenue memo builder");
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, "3.5");
    await userEvent.click(screen.getByRole("button", { name: /update price/i }));

    expect(await screen.findByText("Prompt price updated.")).toBeInTheDocument();

    await waitFor(() => {
      expect(updatePromptPriceMock).toHaveBeenCalledWith(
        expect.anything(),
        { signTransaction },
        "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
        "21",
        "35000000",
      );
      expect(getPromptsByCreatorMock).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText("3.5 XLM")).toBeInTheDocument();
  });

  it("handles bulk pause and bulk activate operations on multi-selected prompts", async () => {
    const prompt1 = makePrompt({ id: 101n, title: "Prompt Alpha", active: true });
    const prompt2 = makePrompt({ id: 102n, title: "Prompt Beta", active: true });

    getPromptsByCreatorMock.mockResolvedValue([prompt1, prompt2]);
    getPromptsByBuyerMock.mockResolvedValue([]);
    setPromptSaleStatusMock.mockResolvedValue({ txHash: "status-hash", success: true });

    const signTransaction = vi.fn().mockResolvedValue({
      signedTxXdr: "signed-transaction-xdr",
    });

    renderWithProviders(<MyPrompts />, {
      wallet: {
        address: "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
        signTransaction,
      },
    });

    expect(await screen.findByText("Prompt Alpha")).toBeInTheDocument();
    expect(screen.getByText("Prompt Beta")).toBeInTheDocument();

    // Select all prompts
    const selectAllBtn = screen.getByRole("button", { name: /Select All/i });
    await userEvent.click(selectAllBtn);

    expect(screen.getByText("2 listing(s) selected")).toBeInTheDocument();

    // Trigger Bulk Pause
    const bulkPauseBtn = screen.getByRole("button", { name: /Bulk Pause/i });
    await userEvent.click(bulkPauseBtn);

    await waitFor(() => {
      expect(setPromptSaleStatusMock).toHaveBeenCalledTimes(2);
      expect(setPromptSaleStatusMock).toHaveBeenCalledWith(
        expect.anything(),
        { signTransaction },
        "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
        "101",
        false,
      );
      expect(setPromptSaleStatusMock).toHaveBeenCalledWith(
        expect.anything(),
        { signTransaction },
        "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
        "102",
        false,
      );
    });

    expect(await screen.findByText("Bulk Pause Results")).toBeInTheDocument();
    expect(screen.getByText("2 Succeeded")).toBeInTheDocument();
  });

  it("triggers confirmation modal on Bulk Retire", async () => {
    const prompt = makePrompt({ id: 103n, title: "Prompt Gamma", active: true });

    getPromptsByCreatorMock.mockResolvedValue([prompt]);
    getPromptsByBuyerMock.mockResolvedValue([]);

    const signTransaction = vi.fn().mockResolvedValue({
      signedTxXdr: "signed-transaction-xdr",
    });

    renderWithProviders(<MyPrompts />, {
      wallet: {
        address: "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
        signTransaction,
      },
    });

    expect(await screen.findByText("Prompt Gamma")).toBeInTheDocument();

    // Select prompt
    const selectAllBtn = screen.getByRole("button", { name: /Select All/i });
    await userEvent.click(selectAllBtn);

    // Trigger Bulk Retire button
    const bulkRetireBtn = screen.getByRole("button", { name: /Bulk Retire/i });
    await userEvent.click(bulkRetireBtn);

    // Confirmation Modal should appear
    expect(await screen.findByText("Confirm Permanent Listing Retire")).toBeInTheDocument();
    expect(
      screen.getByText(/Warning: Retiring listings is an irreversible action/i),
    ).toBeInTheDocument();
  });
});
