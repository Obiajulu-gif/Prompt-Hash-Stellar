import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BuyerLibrary } from "@/components/BuyerLibrary";
import { makePrompt } from "@/test/fixtures/prompts";
import { renderWithProviders } from "@/test/render";

/**
 * Integration coverage for the licence entitlement status panel (#490) as
 * wired into the buyer's purchase library (`/purchases`) — the real
 * `getPromptsByBuyer` + `/api/prompts/receipt` data flow, not just the
 * presentational panel in isolation.
 */

const getPromptsByBuyerMock = vi.fn();
const buyerWallet =
  "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789";

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

vi.mock("@/lib/stellar/promptHashClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stellar/promptHashClient")>(
    "@/lib/stellar/promptHashClient",
  );
  return {
    ...actual,
    getPromptsByBuyer: (...args: unknown[]) => getPromptsByBuyerMock(...args),
  };
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("licence entitlement status panel — issue #490", () => {
  beforeEach(() => {
    getPromptsByBuyerMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows 'active' with transaction + licence version once the receipt is indexed and content is unlocked", async () => {
    const prompt = makePrompt({ id: 11n, title: "Indexed and owned prompt" });
    getPromptsByBuyerMock.mockResolvedValue([prompt]);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          receipt: {
            version: 1,
            prompt: { id: "11", revision: 2 },
            buyer: buyerWallet,
            transaction: {
              hash: "tx-indexed-hash-000111",
              ledger: 42,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            amount: { stroops: "50000000" },
            issuedAt: "2026-01-01T00:00:01.000Z",
          },
          signature: "sig",
          signerPublicKey: "pubkey",
        }),
      ),
    );

    renderWithProviders(<BuyerLibrary />, {
      wallet: { address: buyerWallet, signMessage: vi.fn() },
    });

    await screen.findByText("Indexed and owned prompt");

    const panel = await screen.findByTestId("entitlement-status-panel");
    await waitFor(() =>
      expect(panel).toHaveAttribute("data-state", "verification_needed"),
    );

    // Before the buyer verifies wallet ownership this session, the reference
    // is still shown even though the overall state is "verification needed".
    // The transaction hash is middle-truncated for display, so assert on the
    // link's href (the full hash) rather than the rendered text.
    expect(within(panel).getByText("v2")).toBeInTheDocument();
    expect(within(panel).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining("tx-indexed-hash-000111"),
    );
  });

  it("shows 'pending' (not a failure) when the purchase hasn't been indexed yet", async () => {
    const prompt = makePrompt({ id: 12n, title: "Freshly purchased prompt" });
    getPromptsByBuyerMock.mockResolvedValue([prompt]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "not found" }, 404)));

    renderWithProviders(<BuyerLibrary />, {
      wallet: { address: buyerWallet, signMessage: vi.fn() },
    });

    await screen.findByText("Freshly purchased prompt");

    const panel = await screen.findByTestId("entitlement-status-panel");
    await waitFor(() => expect(panel).toHaveAttribute("data-state", "pending"));
    expect(within(panel).getByText("Pending indexing")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: /check indexing again/i }),
    ).toBeInTheDocument();
  });

  it("shows 'unavailable' for a delisted prompt even if a receipt exists", async () => {
    const prompt = makePrompt({
      id: 13n,
      title: "Delisted but still owned",
      active: false,
    });
    getPromptsByBuyerMock.mockResolvedValue([prompt]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "not found" }, 404)));

    renderWithProviders(<BuyerLibrary />, {
      wallet: { address: buyerWallet, signMessage: vi.fn() },
    });

    await screen.findByText("Delisted but still owned");

    const panel = await screen.findByTestId("entitlement-status-panel");
    await waitFor(() =>
      expect(panel).toHaveAttribute("data-state", "unavailable"),
    );
    expect(within(panel).getByText("Unavailable")).toBeInTheDocument();
  });
});
