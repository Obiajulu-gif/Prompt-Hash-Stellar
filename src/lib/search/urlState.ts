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
