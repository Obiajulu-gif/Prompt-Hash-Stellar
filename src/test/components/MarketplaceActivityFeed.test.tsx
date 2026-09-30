// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetAllPrompts = vi.fn();
const mockGetRecentPurchases = vi.fn();

vi.mock("@/lib/stellar/promptHashClient", () => ({
  getAllPrompts: (...args: any[]) => mockGetAllPrompts(...args),
  getRecentPurchases: (...args: any[]) => mockGetRecentPurchases(...args),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MarketplaceActivityFeed,
  fetchActivityFeed,
  ActivitySkeleton,
  ActivityEmptyState,
  ActivityRow,
  type ActivityItem,
} from "@/components/MarketplaceActivityFeed";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

describe("MarketplaceActivityFeed Component (Issue #262)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchActivityFeed", () => {
    it("aggregates recent listings, updates, and sales chronologically", async () => {
      mockGetAllPrompts.mockResolvedValueOnce([
        {
          id: 101n,
          title: "Prompt Listing 101",
          category: "Art",
          creator: "GCREATOR_ALICE",
          priceStroops: 500_000_000n,
          salesCount: 1,
          active: true,
          contentHash: "hash-101",
          revision: 2, // Has updates
          imageUrl: "https://example.com/art.png",
          previewText: "Preview",
        },
        {
          id: 100n,
          title: "Prompt Listing 100",
          category: "Code",
          creator: "GCREATOR_BOB",
          priceStroops: 250_000_000n,
          salesCount: 0,
          active: true,
          contentHash: "hash-100",
          revision: 1, // Only initial listing
          imageUrl: "https://example.com/code.png",
          previewText: "Preview",
        },
      ]);

      mockGetRecentPurchases.mockResolvedValueOnce([
        {
          id: "sale-event-1",
          type: "sale",
          title: "Prompt #101",
          category: "Marketplace",
          actor: "GBUYER_CHARLIE",
          timestamp: new Date().toISOString(),
          priceXlm: "50.00",
        },
      ]);

      const items = await fetchActivityFeed();

      // Expect at least 3 items: 1 update, 2 listings, 1 sale
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.some((item) => item.type === "new_listing")).toBe(true);
      expect(items.some((item) => item.type === "update")).toBe(true);
      expect(items.some((item) => item.type === "sale")).toBe(true);

      const updateItem = items.find((item) => item.type === "update");
      expect(updateItem?.title).toBe("Prompt Listing 101");
      expect(updateItem?.priceXlm).toBe("50.00");
      expect(updateItem?.category).toBe("Art");

      const saleItem = items.find((item) => item.type === "sale");
      expect(saleItem?.actor).toBe("GBUYER_CHARLIE");
    });

    it("handles errors gracefully and returns empty list if calls fail", async () => {
      mockGetAllPrompts.mockRejectedValueOnce(new Error("Network failure"));
      mockGetRecentPurchases.mockRejectedValueOnce(new Error("Network failure"));

      const items = await fetchActivityFeed();
      expect(items).toEqual([]);
    });
  });

  describe("Subcomponents and States Rendering", () => {
    it("renders loading skeleton with accessibility attributes", () => {
      const markup = renderToStaticMarkup(<ActivitySkeleton />);
      expect(markup).toContain('role="status"');
      expect(markup).toContain('aria-label="Loading activity feed"');
      expect(markup).toContain("animate-pulse");
    });

    it("renders empty state with appropriate message", () => {
      const markup = renderToStaticMarkup(<ActivityEmptyState />);
      expect(markup).toContain("No recent activity");
      expect(markup).toContain("New listings, prompt updates, and license sales will appear here.");
    });

    it("renders empty state with filter specific text", () => {
      const markup = renderToStaticMarkup(<ActivityEmptyState filter="update" />);
      expect(markup).toContain("No update events recorded yet.");
    });

    it("renders activity rows for listings, updates, and sales correctly", () => {
      const items: ActivityItem[] = [
        {
          id: "item-1",
          type: "new_listing",
          title: "Neural Vision Prompt",
          category: "Vision",
          actor: "GAB1234567890CDEFGHIJKLMNOPQRSTUVW",
          timestamp: new Date().toISOString(),
          priceXlm: "25.00",
        },
        {
          id: "item-2",
          type: "update",
          title: "Refined Vision Prompt",
          category: "Vision",
          actor: "GAB1234567890CDEFGHIJKLMNOPQRSTUVW",
          timestamp: new Date(Date.now() - 60_000 * 5).toISOString(),
        },
        {
          id: "item-3",
          type: "sale",
          title: "Prompt License Acquired",
          category: "Marketplace",
          actor: "GBUYER1234567890CDEFGHIJKLMNOPQRST",
          timestamp: new Date(Date.now() - 60_000 * 30).toISOString(),
          priceXlm: "10.00",
        },
      ];

      for (const item of items) {
        const markup = renderToStaticMarkup(<ActivityRow item={item} />);
        expect(markup).toContain(item.title);
        expect(markup).toContain(item.category);
      }
    });

    it("renders MarketplaceActivityFeed structure with query provider", () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      });

      const markup = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MarketplaceActivityFeed />
        </QueryClientProvider>,
      );

      expect(markup).toContain("Live Activity");
      expect(markup).toContain('role="region"');
      expect(markup).toContain('aria-label="Marketplace activity feed"');
    });
  });
});
