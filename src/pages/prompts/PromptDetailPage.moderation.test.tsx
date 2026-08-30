import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import PromptDetailPage from "./PromptDetailPage";
import { makePrompt } from "@/test/fixtures/prompts";
import { renderWithProviders } from "@/test/render";

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

/** Control the moderation endpoint response for a given onChainId. */
function stubModeration(moderation: { moderationStatus?: string; moderationReason?: string } | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/prompts/index")) {
        const body = moderation
          ? [{ onChainId: "42", ...moderation }]
          : [];
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

describe("PromptDetailPage — issue #717 moderation propagation", () => {
  beforeEach(() => {
    getPromptMock.mockReset();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a moderation banner and Moderated badge when the prompt is restricted", async () => {
    getPromptMock.mockResolvedValue(
      makePrompt({ id: 42n, title: "Restricted listing", active: true }),
    );
    stubModeration({ moderationStatus: "restricted", moderationReason: "copyright" });

    renderDetailPage("/prompts/42");

    expect(await screen.findByText("Restricted listing")).toBeInTheDocument();
    expect(
      await screen.findByText(/currently restricted by a moderator/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/reason: copyright/i)).toBeInTheDocument();
    expect(screen.getByText("Moderated")).toBeInTheDocument();
  });

  it("shows a retired banner when the prompt is retired", async () => {
    getPromptMock.mockResolvedValue(
      makePrompt({ id: 42n, title: "Retired listing", active: true }),
    );
    stubModeration({ moderationStatus: "retired", moderationReason: "policy_violation" });

    renderDetailPage("/prompts/42");

    expect(await screen.findByText(/has been retired by a moderator/i)).toBeInTheDocument();
  });

  it("does not render moderation UI for an unmoderated prompt", async () => {
    getPromptMock.mockResolvedValue(
      makePrompt({ id: 42n, title: "Clean listing", active: true }),
    );
    stubModeration({ moderationStatus: "none" });

    renderDetailPage("/prompts/42");

    await screen.findByText("Clean listing");
    await waitFor(() => {
      expect(screen.queryByText("Moderated")).not.toBeInTheDocument();
    });
  });

  it("tolerates a failed moderation lookup and still renders the prompt", async () => {
    getPromptMock.mockResolvedValue(makePrompt({ id: 42n, title: "Resilient listing" }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("moderation api down")),
    );

    renderDetailPage("/prompts/42");

    expect(await screen.findByText("Resilient listing")).toBeInTheDocument();
    expect(screen.queryByText("Moderated")).not.toBeInTheDocument();
  });
});
