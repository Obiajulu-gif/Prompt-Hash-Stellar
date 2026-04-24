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

    const priceInput = screen.getByLabelText("Price for Revenue memo builder");
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, "3.5");
    await userEvent.click(screen.getByRole("button", { name: /update price/i }));

    expect(await screen.findByText("Prompt price updated.")).toBeInTheDocument();

    await waitFor(() => {
      expect(updatePromptPriceMock).toHaveBeenCalledWith(
        expect.anything(),
        { signTransaction },
        "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
        21n,
        3_5000000n,
      );
      expect(getPromptsByCreatorMock).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText("3.5 XLM")).toBeInTheDocument();
  });
});
