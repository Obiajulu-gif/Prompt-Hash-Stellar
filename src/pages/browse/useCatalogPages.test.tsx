// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCatalogPages } from "./useCatalogPages";
import { getAllPromptsPaginated } from "@/lib/stellar/promptHashClient";

vi.mock("@/lib/stellar/promptHashClient", () => ({
  getAllPromptsPaginated: vi.fn(),
}));

const mockFetch = getAllPromptsPaginated as unknown as ReturnType<typeof vi.fn>;

const page1 = {
  prompts: [
    { id: 1n, title: "A", creator: "c", priceStroops: 1n, category: "", previewText: "", description: "", tags: [], imageUrl: "", salesCount: 0, active: true, contentHash: "" },
    { id: 2n, title: "B", creator: "c", priceStroops: 1n, category: "", previewText: "", description: "", tags: [], imageUrl: "", salesCount: 0, active: true, contentHash: "" },
  ],
  nextCursor: "cursor-2",
};

const page2 = {
  prompts: [
    { id: 3n, title: "C", creator: "c", priceStroops: 1n, category: "", previewText: "", description: "", tags: [], imageUrl: "", salesCount: 0, active: true, contentHash: "" },
  ],
  nextCursor: null,
};

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const config = { promptHashContractId: "C123" } as any;

describe("useCatalogPages (paginated browse source)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("loads the first page without a cursor", async () => {
    mockFetch.mockResolvedValueOnce(page1);

    const { result } = renderHook(() => useCatalogPages(config), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(mockFetch).toHaveBeenCalledWith(config, null, expect.any(Number));
    expect(result.current.data?.pages[0].prompts).toHaveLength(2);
  });

  it("appends the next page instead of replacing results", async () => {
    mockFetch.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const { result } = renderHook(() => useCatalogPages(config), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));

    act(() => {
      result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    // Append behavior: both pages are retained, not replaced.
    const all = result.current.data?.pages.flatMap((p) => p.prompts) ?? [];
    expect(all).toHaveLength(3);
    expect(all.map((p) => p.id)).toEqual([1n, 2n, 3n]);

    // The first page's contents are still present (not overwritten).
    expect(result.current.data?.pages[0].prompts.map((p) => p.id)).toEqual([1n, 2n]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("passes the previous nextCursor as the cursor for the following page", async () => {
    mockFetch.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const { result } = renderHook(() => useCatalogPages(config), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    act(() => {
      result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    // Second call used the cursor returned by the first page.
    expect(mockFetch).toHaveBeenNthCalledWith(2, config, "cursor-2", expect.any(Number));
  });
});
