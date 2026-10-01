import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MyPrompts } from "@/pages/sell/MyPrompts";
import { renderWithProviders } from "@/test/render";

const walletAddress =
  "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890";

const ownedPrompt = {
  id: 42n,
  creator: walletAddress,
  title: "My flagged listing",
  category: "Marketing",
  previewText: "Should show moderation status",
  description: "",
  imageUrl: "",
  priceStroops: 20000000n,
  salesCount: 3,
  active: true,
  revision: 1,
};

const getPromptsByCreatorMock = vi.fn();

vi.mock("@/lib/stellar/promptHashClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stellar/promptHashClient")>(
    "@/lib/stellar/promptHashClient",
  );
  return {
    ...actual,
    getPromptsByCreator: (...args: unknown[]) => getPromptsByCreatorMock(...args),
    getPromptsByBuyer: () => Promise.resolve([]),
  };
});

vi.mock("@/lib/prompts/PromptArchiveStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/prompts/PromptArchiveStore")>(
    "@/lib/prompts/PromptArchiveStore",
  );
  return {
    ...actual,
    getArchivedPromptIds: () => new Set<string>(),
  };
});

function stubCreatorModeration(status: string | null, reason: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/prompts/index")) {
        const body = status
          ? [{ onChainId: "42", moderationStatus: status, moderationReason: reason }]
          : [];
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

describe("MyPrompts — issue #717 creator dashboard moderation", () => {
  beforeEach(() => {
    getPromptsByCreatorMock.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the current moderation status and reason for an owned prompt", async () => {
    getPromptsByCreatorMock.mockResolvedValue([ownedPrompt]);
    stubCreatorModeration("restricted", "abuse");

    renderWithProviders(<MyPrompts />, { wallet: { address: walletAddress } });

    expect(await screen.findByText("My flagged listing")).toBeInTheDocument();
    expect(await screen.findByText(/Restricted/i)).toBeInTheDocument();
    expect(screen.getByText(/abuse/i)).toBeInTheDocument();
  });

  it("does not show a moderation badge for a clean prompt", async () => {
    getPromptsByCreatorMock.mockResolvedValue([ownedPrompt]);
    stubCreatorModeration(null, null);

    renderWithProviders(<MyPrompts />, { wallet: { address: walletAddress } });

    await screen.findByText("My flagged listing");
    await waitFor(() => {
      expect(screen.queryByText(/Restricted/i)).not.toBeInTheDocument();
    });
  });
});
