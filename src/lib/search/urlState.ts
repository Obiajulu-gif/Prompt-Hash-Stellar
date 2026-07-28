/**
 * URL state management for marketplace search and filters
 * Preserves search state in URL query parameters
 */

export interface SearchState {
  searchQuery: string;
  selectedCategory: string;
  selectedTag: string;
  priceRange: [number, number];
  sortBy: string;
}

export const DEFAULT_SEARCH_STATE: SearchState = {
  searchQuery: "",
  selectedCategory: "",
  selectedTag: "",
  priceRange: [0, 25],
  sortBy: "recent",
};

/**
 * Get search state from URL query parameters
 */
export function getSearchStateFromUrl(): Partial<SearchState> {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);
  const priceMin = params.get("priceMin");
  const priceMax = params.get("priceMax");

  return {
    searchQuery: params.get("q") || undefined,
    selectedCategory: params.get("category") || undefined,
    selectedTag: params.get("tag") || undefined,
    priceRange:
      priceMin && priceMax ? [Number(priceMin), Number(priceMax)] : undefined,
    sortBy: params.get("sort") || undefined,
  };
}

/**
 * Update URL with search state (shallow navigation)
 */
export function updateUrlWithSearchState(state: Partial<SearchState>) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);

  // Update or remove parameters
  if (state.searchQuery) {
    params.set("q", state.searchQuery);
  } else {
    params.delete("q");
  }

  if (state.selectedCategory) {
    params.set("category", state.selectedCategory);
  } else {
    params.delete("category");
  }

  if (state.selectedTag) {
    params.set("tag", state.selectedTag);
  } else {
    params.delete("tag");
  }

  if (
    state.priceRange &&
    (state.priceRange[0] !== 0 || state.priceRange[1] !== 25)
  ) {
    params.set("priceMin", state.priceRange[0].toString());
    params.set("priceMax", state.priceRange[1].toString());
  } else {
    params.delete("priceMin");
    params.delete("priceMax");
  }

  if (state.sortBy && state.sortBy !== "recent") {
    params.set("sort", state.sortBy);
  } else {
    params.delete("sort");
  }

  // Update URL without full page reload
  const newUrl = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;

  window.history.replaceState(null, "", newUrl);
}

/**
 * Build query string from search state
 */
export function buildSearchQueryString(state: Partial<SearchState>): string {
  const params = new URLSearchParams();

  if (state.searchQuery) {
    params.set("q", state.searchQuery);
  }

  if (state.selectedCategory) {
    params.set("category", state.selectedCategory);
  }

  if (state.selectedTag) {
    params.set("tag", state.selectedTag);
  }

  if (
    state.priceRange &&
    (state.priceRange[0] !== 0 || state.priceRange[1] !== 25)
  ) {
    params.set("priceMin", state.priceRange[0].toString());
    params.set("priceMax", state.priceRange[1].toString());
  }

  if (state.sortBy && state.sortBy !== "recent") {
    params.set("sort", state.sortBy);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

/**
 * "Return to marketplace" memory — Issue #497.
 *
 * The marketplace listing pages (`/browse`) already mirror their filters into
 * the URL (see above), so a hard reload or a shared link on THOSE pages
 * restores correctly. The gap is navigating away entirely (e.g. to a prompt
 * detail page at `/prompts/:id`) and back: an in-app "Back to marketplace"
 * link that hardcodes `/browse` drops whatever filters were active.
 *
 * This stores only the last-visited marketplace URL (pathname + safe filter
 * query params, no wallet/user data) in `sessionStorage` so a detail page can
 * link back to the filtered view the buyer actually came from, even across a
 * reload of the detail page itself. It intentionally only remembers listing
 * routes (`/browse` today) — never arbitrary pages — since those are the only
 * "safe" filters this feature is scoped to restore.
 */
const MARKETPLACE_RETURN_STORAGE_KEY = "prompt-hash:last-marketplace-url";
const SAFE_MARKETPLACE_PATHS = ["/browse"];

/** Records the current marketplace URL so a detail page can link back to it. */
export function rememberMarketplaceReturnUrl(
  pathname: string = typeof window !== "undefined" ? window.location.pathname : "",
  search: string = typeof window !== "undefined" ? window.location.search : "",
): void {
  if (typeof window === "undefined") return;
  if (!SAFE_MARKETPLACE_PATHS.includes(pathname)) return;

  try {
    window.sessionStorage.setItem(
      MARKETPLACE_RETURN_STORAGE_KEY,
      `${pathname}${search}`,
    );
  } catch {
    // Storage can be unavailable (private browsing, quota) — safe to ignore,
    // callers fall back to the default marketplace route.
  }
}

/** Returns the last-remembered marketplace URL, or null if none is stored. */
export function getMarketplaceReturnUrl(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.sessionStorage.getItem(MARKETPLACE_RETURN_STORAGE_KEY);
    if (!stored) return null;
    const pathname = stored.split("?")[0];
    return SAFE_MARKETPLACE_PATHS.includes(pathname) ? stored : null;
  } catch {
    return null;
  }
}
