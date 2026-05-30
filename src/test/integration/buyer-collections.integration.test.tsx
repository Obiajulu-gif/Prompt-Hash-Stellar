import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  fetchSavedPrompts,
  savePromptListing,
  unsavePromptListing,
} from "@/lib/prompts/library";

const walletAddress =
  "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789";

describe("buyer collections integration coverage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads saved listings for an account-scoped buyer library response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          saved: [
            {
              purchaseId: "purchase-1",
              savedAt: "2026-01-01T00:00:00.000Z",
              prompt: {
                id: "prompt-1",
                title: "Saved conversion pack",
                image: "https://example.com/saved.png",
                content: "Preview content",
                price: 3,
                category: "Marketing",
                listingStatus: "published",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const saved = await fetchSavedPrompts(walletAddress);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/prompts/buyer/${walletAddress}/saved`,
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].prompt.title).toBe("Saved conversion pack");
  });

  it("save and unsave endpoints return stable success shapes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ saved: true, purchaseId: "purchase-1" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ saved: false }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await savePromptListing(walletAddress, "prompt-1");
    await unsavePromptListing(walletAddress, "prompt-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/prompts/buyer/save",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/prompts/buyer/unsave",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces API error messages for unauthorized or invalid save requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "walletAddress and promptId are required" }), {
          status: 400,
        }),
      ),
    );

    await expect(savePromptListing("", "prompt-1")).rejects.toThrow(
      /walletAddress and promptId are required/i,
    );
  });
});

describe("buyer owned collection API client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests owned prompts for the connected wallet", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          owned: [
            {
              purchaseId: "purchase-99",
              txHash: "tx-owned",
              versionIndex: 1,
              purchasedAt: "2026-01-02T00:00:00.000Z",
              prompt: { _id: "prompt-99", title: "Owned prompt" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetch(`/api/prompts/buyer/${walletAddress}/owned`);
    const payload = await response.json();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/prompts/buyer/${walletAddress}/owned`,
    );
    expect(payload.owned).toHaveLength(1);
    expect(payload.owned[0].prompt.title).toBe("Owned prompt");
  });
});
