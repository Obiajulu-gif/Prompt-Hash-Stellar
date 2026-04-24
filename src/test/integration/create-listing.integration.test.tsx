import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreatePromptForm } from "@/pages/sell/CreatePromptForm";
import { renderWithProviders } from "@/test/render";

const encryptPromptPlaintextMock = vi.fn();
const wrapPromptKeyMock = vi.fn();
const createPromptMock = vi.fn();

vi.mock("@/lib/env", () => ({
  unlockPublicKey: "unlock-public-key",
}));

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

vi.mock("@/lib/crypto/promptCrypto", () => ({
  encryptPromptPlaintext: (...args: unknown[]) =>
    encryptPromptPlaintextMock(...args),
  wrapPromptKey: (...args: unknown[]) => wrapPromptKeyMock(...args),
}));

vi.mock("@/lib/stellar/promptHashClient", () => ({
  createPrompt: (...args: unknown[]) => createPromptMock(...args),
}));

async function selectCategory(name: string) {
  await userEvent.click(screen.getByRole("combobox", { name: /category/i }));
  await userEvent.click(await screen.findByRole("option", { name }));
}

describe("create listing integration coverage", () => {
  it("validates the listing form before any contract mutation is attempted", async () => {
    renderWithProviders(<CreatePromptForm />);

    const priceInput = screen.getByLabelText(/price in xlm/i);
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, "0");

    await userEvent.click(
      screen.getByRole("button", { name: /create prompt listing/i }),
    );

    expect(await screen.findByText("Image URL is required.")).toBeInTheDocument();
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByText("Category is required.")).toBeInTheDocument();
    expect(screen.getByText("Preview text is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Full prompt content is required."),
    ).toBeInTheDocument();
    expect(screen.getByText("Price must be greater than zero.")).toBeInTheDocument();
    expect(createPromptMock).not.toHaveBeenCalled();
  });

  it("encrypts and submits a valid listing with mocked Soroban boundaries", async () => {
    encryptPromptPlaintextMock.mockResolvedValue({
      encryptedPrompt: "encrypted-prompt",
      encryptionIv: "encryption-iv",
      contentHash: "b".repeat(64),
      keyBytes: new Uint8Array([1, 2, 3, 4]),
    });
    wrapPromptKeyMock.mockResolvedValue("wrapped-key");
    createPromptMock.mockResolvedValue({
      promptId: 17n,
      txHash: "tx-hash-123",
    });

    const signTransaction = vi.fn().mockResolvedValue({
      signedTxXdr: "signed-transaction-xdr",
    });

    renderWithProviders(<CreatePromptForm />, {
      wallet: {
        address: "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
        signTransaction,
      },
    });

    await userEvent.type(
      screen.getByLabelText(/image url/i),
      "https://example.com/new-cover.png",
    );
    await userEvent.type(screen.getByLabelText(/title/i), "Campaign launch pack");
    await selectCategory("Marketing");
    await userEvent.type(
      screen.getByLabelText(/preview text/i),
      "Public preview for the integration test listing.",
    );
    await userEvent.type(
      screen.getByLabelText(/full prompt/i),
      "Private prompt body that will be encrypted before submission.",
    );

    const priceInput = screen.getByLabelText(/price in xlm/i);
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, "3.75");

    await userEvent.click(
      screen.getByRole("button", { name: /create prompt listing/i }),
    );

    await waitFor(() => {
      expect(encryptPromptPlaintextMock).toHaveBeenCalledWith(
        "Private prompt body that will be encrypted before submission.",
      );
    });

    expect(wrapPromptKeyMock).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3, 4]),
      "unlock-public-key",
    );
    expect(createPromptMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Prompt #17 created successfully.")).toBeInTheDocument();
  });
});
