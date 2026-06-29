import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getSearchStateFromUrl,
  updateUrlWithSearchState,
  buildSearchQueryString,
  DEFAULT_SEARCH_STATE,
} from "./urlState";

describe("urlState", () => {
  beforeEach(() => {
    // Reset URL to clean state
    window.history.replaceState(null, "", "/");
  });

  describe("getSearchStateFromUrl", () => {
    it("should return empty state when no query params", () => {
      window.history.replaceState(null, "", "/?");
      const state = getSearchStateFromUrl();
      expect(state.searchQuery).toBeUndefined();
      expect(state.selectedCategory).toBeUndefined();
      expect(state.priceRange).toBeUndefined();
    });

    it("should parse search query from URL", () => {
      window.history.replaceState(null, "", "/?q=architecture");
      const state = getSearchStateFromUrl();
      expect(state.searchQuery).toBe("architecture");
    });

    it("should parse category from URL", () => {
      window.history.replaceState(
        null,
        "",
        "/?category=Software%20Development",
      );
      const state = getSearchStateFromUrl();
      expect(state.selectedCategory).toBe("Software Development");
    });

    it("should parse price range from URL", () => {
      window.history.replaceState(null, "", "/?priceMin=5&priceMax=20");
      const state = getSearchStateFromUrl();
      expect(state.priceRange).toEqual([5, 20]);
    });

    it("should parse sort option from URL", () => {
      window.history.replaceState(null, "", "/?sort=price-low");
      const state = getSearchStateFromUrl();
      expect(state.sortBy).toBe("price-low");
    });

    it("should parse all params together", () => {
      window.history.replaceState(
        null,
        "",
        "/?q=test&category=Sales&tag=AI&priceMin=0&priceMax=15&sort=sales",
      );
      const state = getSearchStateFromUrl();
      expect(state.searchQuery).toBe("test");
      expect(state.selectedCategory).toBe("Sales");
      expect(state.selectedTag).toBe("AI");
      expect(state.priceRange).toEqual([0, 15]);
      expect(state.sortBy).toBe("sales");
    });
  });

  describe("buildSearchQueryString", () => {
    it("should build empty string when no state provided", () => {
      const qs = buildSearchQueryString({});
      expect(qs).toBe("");
    });

    it("should build query string with search query", () => {
      const qs = buildSearchQueryString({ searchQuery: "architecture" });
      expect(qs).toContain("q=architecture");
    });

    it("should not include default price range", () => {
      const qs = buildSearchQueryString({ priceRange: [0, 25] });
      expect(qs).not.toContain("priceMin");
      expect(qs).not.toContain("priceMax");
    });

    it("should include non-default price range", () => {
      const qs = buildSearchQueryString({ priceRange: [5, 20] });
      expect(qs).toContain("priceMin=5");
      expect(qs).toContain("priceMax=20");
    });

    it("should not include default sort", () => {
      const qs = buildSearchQueryString({ sortBy: "recent" });
      expect(qs).not.toContain("sort");
    });

    it("should include non-default sort", () => {
      const qs = buildSearchQueryString({ sortBy: "price-low" });
      expect(qs).toContain("sort=price-low");
    });
  });

  describe("updateUrlWithSearchState", () => {
    it("should update URL without full page reload", () => {
      const replaceSpy = vi.spyOn(window.history, "replaceState");

      updateUrlWithSearchState({ searchQuery: "test" });

      expect(replaceSpy).toHaveBeenCalled();
      expect(window.location.search).toContain("q=test");
    });

    it("should remove params when values are cleared", () => {
      window.history.replaceState(null, "", "/?q=test&category=Sales");
      updateUrlWithSearchState({ searchQuery: "", selectedCategory: "" });

      expect(window.location.search).not.toContain("q");
      expect(window.location.search).not.toContain("category");
    });
  });

  describe("DEFAULT_SEARCH_STATE", () => {
    it("should have correct defaults", () => {
      expect(DEFAULT_SEARCH_STATE.searchQuery).toBe("");
      expect(DEFAULT_SEARCH_STATE.selectedCategory).toBe("");
      expect(DEFAULT_SEARCH_STATE.priceRange).toEqual([0, 25]);
      expect(DEFAULT_SEARCH_STATE.sortBy).toBe("recent");
    });
  });
});
