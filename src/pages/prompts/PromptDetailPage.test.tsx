import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import PromptDetailPage from "./PromptDetailPage";
import { makePrompt } from "@/test/fixtures/prompts";
import { renderWithProviders } from "@/test/render";
import { rememberMarketplaceReturnUrl } from "@/lib/search/urlState";

// PromptDetailPage reads the prompt id via useParams(), so it must be
// rendered under a matching <Route> (not just a bare MemoryRouter) for the
// dynamic :id segment to resolve — otherwise useParams() always returns {}.
function renderDetailPage(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/prompts/:id" element={<PromptDetailPage />} />
    </Routes>,
    { route },
  );
}

const getPromptMock = vi.fn();

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
    getPrompt: (...args: unknown[]) => getPromptMock(...args),
  };
});

describe("PromptDetailPage — issue #497 deep links", () => {
  beforeEach(() => {
    getPromptMock.mockReset();
    window.sessionStorage.clear();
    // PriceHistoryCard / ReportDialog fire fetches this page doesn't need to
    // exercise here — stub them out so tests stay deterministic and offline.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network disabled in test")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a clear fallback for a non-numeric (invalid) prompt id", async () => {
    renderDetailPage("/prompts/not-a-number");

    expect(await screen.findByText(/prompt not found/i)).toBeInTheDocument();
    expect(
      screen.getByText(/removed or the link is incorrect/i),
    ).toBeInTheDocument();
    expect(getPromptMock).not.toHaveBeenCalled();
  });

  it("shows a clear fallback when the prompt id does not resolve on-chain", async () => {
    getPromptMock.mockRejectedValue(new Error("Prompt #999 not found."));

    renderDetailPage("/prompts/999");

    expect(await screen.findByText(/prompt not found/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /browse marketplace/i }),
    ).toHaveAttribute("href", "/browse");
  });

  it("restores the correct prompt for a valid id (deep link / hard reload)", async () => {
    const prompt = makePrompt({
      id: 42n,
      title: "Deep-linkable launch plan",
      previewText: "Restored directly from the URL, not router state.",
    });
    getPromptMock.mockResolvedValue(prompt);

    renderDetailPage("/prompts/42");

    expect(await screen.findByText("Deep-linkable launch plan")).toBeInTheDocument();
    expect(getPromptMock).toHaveBeenCalledWith(
      expect.anything(),
      42n,
    );
  });

  it("credits and links to the source listing for a remix", async () => {
    getPromptMock.mockResolvedValue(
      makePrompt({
        id: 42n,
        title: "Remixed launch plan",
        sourcePromptId: "7",
      }),
    );

    renderDetailPage("/prompts/42");

    expect(
      await screen.findByRole("link", { name: /prompt #7/i }),
    ).toHaveAttribute("href", "/prompts/7");
    expect(screen.getByText(/inspired by/i)).toBeInTheDocument();
  });

  it("falls back to a plain /browse link when no marketplace filters were remembered", async () => {
    const prompt = makePrompt({ id: 7n, title: "Some prompt" });
    getPromptMock.mockResolvedValue(prompt);

    renderDetailPage("/prompts/7");

    await screen.findByText("Some prompt");
    expect(
      screen.getByRole("link", { name: /back to marketplace/i }),
    ).toHaveAttribute("href", "/browse");
  });

  it("links back to the filtered marketplace view the buyer came from (#497)", async () => {
    rememberMarketplaceReturnUrl("/browse", "?category=Sales&sort=price-low");

    const prompt = makePrompt({ id: 7n, title: "Some prompt" });
    getPromptMock.mockResolvedValue(prompt);

    renderDetailPage("/prompts/7");

    await screen.findByText("Some prompt");
    expect(
      screen.getByRole("link", { name: /back to marketplace/i }),
    ).toHaveAttribute("href", "/browse?category=Sales&sort=price-low");
  });
});
