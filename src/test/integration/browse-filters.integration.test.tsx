import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BrowsePage from "@/pages/browse/page.jsx";
import FetchAllPrompts from "@/pages/browse/FetchAllPrompts";
import { makePrompt } from "@/test/fixtures/prompts";
import { renderWithProviders } from "@/test/render";

const getAllPromptsMock = vi.fn();
const hasAccessMock = vi.fn();

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
  const actual = await vi.importActual("@/lib/stellar/promptHashClient");

  return {
    ...actual,
    getAllPrompts: (...args: unknown[]) => getAllPromptsMock(...args),
    hasAccess: (...args: unknown[]) => hasAccessMock(...args),
  };
});

vi.mock("@/lib/reviews/reviewClient", () => ({
  ReviewClient: {
    getReviewStats: vi.fn().mockResolvedValue({ averageRating: 0, total: 0 }),
  },
}));

describe("browse marketplace filters", () => {
  it("updates search input and category chips on the browse page", async () => {
    hasAccessMock.mockResolvedValue(false);
    getAllPromptsMock.mockResolvedValue([]);

    renderWithProviders(<BrowsePage />, { route: "/browse" });

    const searchInput = screen.getByRole("textbox", {
      name: /search marketplace prompts/i,
    });
    await userEvent.type(searchInput, "creative");
    expect(searchInput).toHaveValue("creative");

    const creativeChip = screen.getAllByRole("button", { name: "Creative" })[0];
    await userEvent.click(creativeChip);

    await waitFor(() => {
      expect(creativeChip.className).toContain("border-emerald-400/50");
    });
  });

  it("filters by search text and sorts by sales count through the derived query", async () => {
    hasAccessMock.mockResolvedValue(false);
    getAllPromptsMock.mockResolvedValue([
      makePrompt({
        id: 11n,
        title: "Marketing Launch Kit",
        category: "Marketing",
        previewText: "Campaign planning workspace.",
        salesCount: 2,
      }),
      makePrompt({
        id: 12n,
        title: "Creative Brief Builder",
        category: "Creative",
        previewText: "Concept prompts for art direction.",
        salesCount: 19,
      }),
      makePrompt({
        id: 13n,
        title: "Creative Review Loop",
        category: "Creative",
        previewText: "Feedback framework for visual teams.",
        salesCount: 7,
      }),
    ]);

    renderWithProviders(
      <FetchAllPrompts
        selectedCategory="Creative"
        priceRange={[0, 25]}
        searchQuery="visual"
        sortBy="sales"
      />,
    );

    expect(
      await screen.findByText("Creative Review Loop"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Creative Brief Builder"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Marketing Launch Kit"),
    ).not.toBeInTheDocument();
  });
});
