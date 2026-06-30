import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
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

const BUYER_ADDRESS =
  "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789";
const STRANGER_ADDRESS =
  "GSTRANGERACCOUNT234567890ABCDEFGH1234567890ABCDEFGH12345678";

describe("Issue #219: full purchase-to-unlock integration tests", () => {
  beforeEach(() => {
    getAllPromptsMock.mockReset();
    hasAccessMock.mockReset();
    buyPromptAccessMock.mockReset();
    unlockPromptContentMock.mockReset();
  });

  describe("access verification before purchase", () => {
    it("buyer without access sees purchase UI on prompt card", async () => {
      const prompt = makePrompt({
        id: 100n,
        title: "Premium analysis prompt",
        active: true,
        priceStroops: 10_0000000n,
      });

      getAllPromptsMock.mockResolvedValue([prompt]);
      hasAccessMock.mockImplementation(async () => false);

      renderWithProviders(
        <FetchAllPrompts
          selectedCategory=""
          priceRange={[0, 100]}
          searchQuery=""
          sortBy="recent"
        />,
        {
          wallet: {
            address: BUYER_ADDRESS,
            signTransaction: vi.fn(),
            signMessage: vi.fn(),
          },
        },
      );

      const title = await screen.findByText("Premium analysis prompt");
      expect(title).toBeInTheDocument();

      const cardButton = await screen.findByRole("button", {
        name: `Open ${prompt.title}`,
      });
      await userEvent.click(cardButton);

      const dialog = await screen.findByRole("dialog", {
        name: /acquire license/i,
      });
      expect(dialog).toBeInTheDocument();
    });

    it("stranger has no access to any prompts", async () => {
      const prompt = makePrompt({
        id: 101n,
        title: "Restricted prompt",
        active: true,
      });

      getAllPromptsMock.mockResolvedValue([prompt]);
      hasAccessMock.mockImplementation(async () => false);

      renderWithProviders(
        <FetchAllPrompts
          selectedCategory=""
          priceRange={[0, 100]}
          searchQuery=""
          sortBy="recent"
        />,
        {
          wallet: {
            address: STRANGER_ADDRESS,
            signTransaction: vi.fn(),
          },
        },
      );

      await screen.findByText("Restricted prompt");
      expect(
        screen.queryByRole("button", { name: /owned/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("unlock fails for non-buyers", () => {
    it("unlock fails with ACCESS_NOT_PURCHASED for non-buyers", async () => {
      const prompt = makePrompt({
        id: 104n,
        title: "Protected prompt",
      });

      getAllPromptsMock.mockResolvedValue([prompt]);
      hasAccessMock.mockImplementation(async () => true);
      unlockPromptContentMock.mockRejectedValue(
        new Error("ACCESS_NOT_PURCHASED: You have not purchased this prompt."),
      );

      const signMessage = vi.fn().mockResolvedValue({
        signedMessage: "bad-sig",
      });

      renderWithProviders(
        <FetchAllPrompts
          selectedCategory=""
          selectedTag=""
          priceRange={[0, 100]}
          searchQuery=""
          sortBy="recent"
        />,
        {
          wallet: {
            address: STRANGER_ADDRESS,
            signMessage,
          },
        },
      );

      await screen.findByText(prompt.title);
      const cardButton = await screen.findByRole("button", {
        name: `Open ${prompt.title}`,
      });
      await userEvent.click(cardButton);

      const dialog = await screen.findByRole("dialog", {
        name: /acquire license/i,
      });
      const unlockBtn = within(dialog).getByRole("button", {
        name: /decrypt content/i,
      });
      await userEvent.click(unlockBtn);

      expect(
        await within(dialog).findByText(/access_not_purchased/i),
      ).toBeInTheDocument();
    });

    it("unlock fails with challenge expired error", async () => {
      const prompt = makePrompt({
        id: 105n,
        title: "Expired challenge prompt",
      });

      getAllPromptsMock.mockResolvedValue([prompt]);
      hasAccessMock.mockImplementation(async () => true);
      unlockPromptContentMock.mockRejectedValue(
        new Error("CHALLENGE_EXPIRED: The verification challenge has expired."),
      );

      const signMessage = vi.fn().mockResolvedValue({
        signedMessage: "signed",
      });

      renderWithProviders(
        <FetchAllPrompts
          selectedCategory=""
          selectedTag=""
          priceRange={[0, 100]}
          searchQuery=""
          sortBy="recent"
        />,
        {
          wallet: {
            address: BUYER_ADDRESS,
            signMessage,
          },
        },
      );

      await screen.findByText(prompt.title);
      const cardButton = await screen.findByRole("button", {
        name: `Open ${prompt.title}`,
      });
      await userEvent.click(cardButton);

      const dialog = await screen.findByRole("dialog", {
        name: /acquire license/i,
      });
      await userEvent.click(
        within(dialog).getByRole("button", { name: /decrypt content/i }),
      );

      expect(
        await within(dialog).findByText("Transaction authorization expired."),
      ).toBeInTheDocument();
    });

    it("unlock fails with invalid signature for forged wallet", async () => {
      const prompt = makePrompt({
        id: 109n,
        title: "Signature check prompt",
      });

      getAllPromptsMock.mockResolvedValue([prompt]);
      hasAccessMock.mockImplementation(async () => true);
      unlockPromptContentMock.mockRejectedValue(
        new Error("INVALID_SIGNATURE: Wallet signature does not match the challenge."),
      );

      renderWithProviders(
        <FetchAllPrompts
          selectedCategory=""
          selectedTag=""
          priceRange={[0, 100]}
          searchQuery=""
          sortBy="recent"
        />,
        {
          wallet: {
            address: STRANGER_ADDRESS,
            signMessage: vi.fn().mockResolvedValue({ signedMessage: "forged" }),
          },
        },
      );

      await screen.findByText(prompt.title);
      const cardButton = await screen.findByRole("button", {
        name: `Open ${prompt.title}`,
      });
      await userEvent.click(cardButton);

      const dialog = await screen.findByRole("dialog", {
        name: /acquire license/i,
      });
      await userEvent.click(
        within(dialog).getByRole("button", { name: /decrypt content/i }),
      );

      expect(
        await within(dialog).findByText(/invalid_signature/i),
      ).toBeInTheDocument();
    });
  });

  describe("retry after failure", () => {
    it("retries unlock after initial failure and succeeds on second attempt", async () => {
      const prompt = makePrompt({
        id: 106n,
        title: "Retry unlock prompt",
      });

      getAllPromptsMock.mockResolvedValue([prompt]);
      hasAccessMock.mockImplementation(async () => true);
      unlockPromptContentMock
        .mockRejectedValueOnce(new Error("Temporary network error"))
        .mockResolvedValueOnce({
          promptId: "106",
          title: prompt.title,
          contentHash: prompt.contentHash,
          plaintext: "Successfully decrypted after retry.",
          decryptedContent: "Successfully decrypted after retry.",
        });

      const signMessage = vi.fn().mockResolvedValue({
        signedMessage: "sig",
      });

      renderWithProviders(
        <FetchAllPrompts
          selectedCategory=""
          selectedTag=""
          priceRange={[0, 100]}
          searchQuery=""
          sortBy="recent"
        />,
        {
          wallet: {
            address: BUYER_ADDRESS,
            signMessage,
          },
        },
      );

      await screen.findByText(prompt.title);
      const cardButton = await screen.findByRole("button", {
        name: `Open ${prompt.title}`,
      });
      await userEvent.click(cardButton);

      const dialog = await screen.findByRole("dialog", {
        name: /acquire license/i,
      });

      await userEvent.click(
        within(dialog).getByRole("button", { name: /decrypt content/i }),
      );
      expect(
        await within(dialog).findByText("Could not reach the Stellar network."),
      ).toBeInTheDocument();

      const retryButton = within(dialog).getByRole("button", {
        name: /decrypt content/i,
      });
      await userEvent.click(retryButton);
      expect(
        await within(dialog).findByText(
          "Successfully decrypted after retry.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("marketplace listing visibility", () => {
    it("shows no prompts when marketplace is empty", async () => {
      getAllPromptsMock.mockResolvedValue([]);

      renderWithProviders(
        <FetchAllPrompts
          selectedCategory=""
          priceRange={[0, 100]}
          searchQuery=""
          sortBy="recent"
        />,
      );

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: /confirm & purchase/i }),
        ).not.toBeInTheDocument();
      });
    });

    it("only active prompts are shown to buyers", async () => {
      const active = makePrompt({
        id: 107n,
        title: "Visible active listing",
        active: true,
      });
      const inactive = makePrompt({
        id: 108n,
        title: "Hidden inactive listing",
        active: false,
      });

      getAllPromptsMock.mockResolvedValue([active, inactive]);
      hasAccessMock.mockImplementation(async () => false);

      renderWithProviders(
        <FetchAllPrompts
          selectedCategory=""
          priceRange={[0, 100]}
          searchQuery=""
          sortBy="recent"
        />,
        {
          wallet: {
            address: BUYER_ADDRESS,
            signTransaction: vi.fn(),
          },
        },
      );

      expect(
        await screen.findByText("Visible active listing"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Hidden inactive listing"),
      ).not.toBeInTheDocument();
    });

    it("simulates both creator and buyer wallets viewing the same prompt", async () => {
      const prompt = makePrompt({
        id: 110n,
        title: "Dual-view prompt",
        creator: "GCREATOR_WALLET_ADDRESS_FOR_DUAL_VIEW_TEST_1234567890ABC",
        active: true,
      });

      getAllPromptsMock.mockResolvedValue([prompt]);

      // Buyer view: no access
      hasAccessMock.mockImplementation(async () => false);
      const { unmount } = renderWithProviders(
        <FetchAllPrompts
          selectedCategory=""
          priceRange={[0, 100]}
          searchQuery=""
          sortBy="recent"
        />,
        {
          wallet: { address: BUYER_ADDRESS, signTransaction: vi.fn() },
        },
      );

      await screen.findByText("Dual-view prompt");
      expect(
        screen.queryByRole("button", { name: /owned/i }),
      ).not.toBeInTheDocument();

      unmount();

      // Creator view: has access
      hasAccessMock.mockImplementation(async () => true);
      renderWithProviders(
        <FetchAllPrompts
          selectedCategory=""
          priceRange={[0, 100]}
          searchQuery=""
          sortBy="recent"
        />,
        {
          wallet: {
            address: prompt.creator,
            signTransaction: vi.fn(),
          },
        },
      );

      await screen.findByText("Dual-view prompt");
      await waitFor(() => {
        expect(
          screen.getAllByRole("button", { name: /owned/i }),
        ).toHaveLength(1);
      });
    });
  });
});
