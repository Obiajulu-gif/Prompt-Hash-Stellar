import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DraftManager } from "@/pages/sell/DraftManager";
import { renderWithProviders } from "@/test/render";

const walletAddress =
  "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890";

describe("draft listing lifecycle integration coverage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows disconnected guidance when no wallet is connected", () => {
    renderWithProviders(<DraftManager />);
    expect(
      screen.getByText(/connect your wallet to manage draft listings/i),
    ).toBeInTheDocument();
  });

  it("loads drafts and publishes a ready listing", async () => {
    const drafts = [
      {
        _id: "draft-1",
        title: "Launch checklist",
        image: "https://example.com/cover.png",
        price: 2,
        category: "Marketing",
        listingStatus: "ready" as const,
        missingFields: [],
        isPublishable: true,
        updatedAt: new Date().toISOString(),
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/drafts")) {
        return new Response(JSON.stringify({ drafts }), { status: 200 });
      }
      if (url.includes("/publish") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ listingStatus: "published", promptId: "draft-1" }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<DraftManager />, {
      wallet: { address: walletAddress },
    });

    expect(await screen.findByText("Launch checklist")).toBeInTheDocument();
    expect(screen.getByText(/ready to publish/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/prompts/draft-1/publish",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("surfaces publish validation errors with stable API messages", async () => {
    const drafts = [
      {
        _id: "draft-2",
        title: "Incomplete draft",
        image: "",
        price: 0,
        category: "",
        listingStatus: "draft" as const,
        missingFields: ["image", "content", "price", "category"],
        isPublishable: false,
        updatedAt: new Date().toISOString(),
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/drafts")) {
          return new Response(JSON.stringify({ drafts }), { status: 200 });
        }
        if (url.includes("/publish")) {
          return new Response(
            JSON.stringify({
              error: "Prompt is not publishable",
              fields: { image: "Image URL is required." },
              missingFields: ["image", "content"],
            }),
            { status: 422 },
          );
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    renderWithProviders(<DraftManager />, {
      wallet: { address: walletAddress },
    });

    expect(await screen.findByText("Incomplete draft")).toBeInTheDocument();
    expect(screen.getByText(/missing:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /publish/i })).toBeDisabled();
  });

  it("returns 404-shaped errors for invalid draft ids without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/drafts")) {
          return new Response(JSON.stringify({ drafts: [] }), { status: 200 });
        }
        if (url.includes("/publish")) {
          return new Response(JSON.stringify({ error: "Prompt not found" }), {
            status: 404,
          });
        }
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }),
    );

    renderWithProviders(<DraftManager />, {
      wallet: { address: walletAddress },
    });

    expect(await screen.findByText(/no draft listings/i)).toBeInTheDocument();
  });
});
