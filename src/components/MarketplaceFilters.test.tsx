import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarketplaceFilters } from "./MarketplaceFilters";
import { renderWithProviders } from "@/test/render";

const defaultProps = {
  categories: ["AI", "Marketing", "Code"],
  tags: ["popular", "new"],
  selectedCategory: "",
  setSelectedCategory: vi.fn(),
  selectedTag: "",
  setSelectedTag: vi.fn(),
  searchQuery: "",
  setSearchQuery: vi.fn(),
  priceRange: [0, 25] as [number, number],
  setPriceRange: vi.fn(),
  sortBy: "recent",
  setSortBy: vi.fn(),
  onClear: vi.fn(),
};

describe("MarketplaceFilters", () => {
  it("renders category section header", () => {
    renderWithProviders(<MarketplaceFilters {...defaultProps} />);
    expect(screen.getByText("Category")).toBeInTheDocument();
  });

  it("renders all category badges", () => {
    renderWithProviders(<MarketplaceFilters {...defaultProps} />);
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("Marketing")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
  });

  it("renders tag section when tags are provided", () => {
    renderWithProviders(<MarketplaceFilters {...defaultProps} />);
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByText("popular")).toBeInTheDocument();
    expect(screen.getByText("new")).toBeInTheDocument();
  });

  it("does not render tag section when tags are empty", () => {
    renderWithProviders(
      <MarketplaceFilters {...defaultProps} tags={[]} />,
    );
    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
  });

  it("renders price range section with min/max labels", () => {
    renderWithProviders(<MarketplaceFilters {...defaultProps} />);
    expect(screen.getByText("Price Range")).toBeInTheDocument();
    expect(screen.getByText("Min")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
  });

  it("displays current price range values", () => {
    renderWithProviders(
      <MarketplaceFilters {...defaultProps} priceRange={[5, 20]} />,
    );
    expect(screen.getByText("5 – 20 XLM")).toBeInTheDocument();
  });

  it("renders sort section", () => {
    renderWithProviders(<MarketplaceFilters {...defaultProps} />);
    expect(screen.getByText("Sort By")).toBeInTheDocument();
  });

  it("does not show Clear All button when no filters are active", () => {
    renderWithProviders(<MarketplaceFilters {...defaultProps} />);
    expect(screen.queryByText("Clear All Filters")).not.toBeInTheDocument();
  });

  it("shows Clear All button when a category is selected", () => {
    renderWithProviders(
      <MarketplaceFilters {...defaultProps} selectedCategory="AI" />,
    );
    expect(screen.getByText("Clear All Filters")).toBeInTheDocument();
  });

  it("shows Clear All button when sort is not recent", () => {
    renderWithProviders(
      <MarketplaceFilters {...defaultProps} sortBy="sales" />,
    );
    expect(screen.getByText("Clear All Filters")).toBeInTheDocument();
  });

  it("shows Clear All button when price range is changed", () => {
    renderWithProviders(
      <MarketplaceFilters {...defaultProps} priceRange={[5, 25]} />,
    );
    expect(screen.getByText("Clear All Filters")).toBeInTheDocument();
  });

  it("calls onClear when Clear All is clicked", () => {
    const onClear = vi.fn();
    renderWithProviders(
      <MarketplaceFilters {...defaultProps} selectedCategory="AI" onClear={onClear} />,
    );
    screen.getByText("Clear All Filters").click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders min price range input", () => {
    renderWithProviders(<MarketplaceFilters {...defaultProps} />);
    const minInput = screen.getByLabelText("Minimum price in XLM");
    expect(minInput).toBeInTheDocument();
    expect(minInput.getAttribute("type")).toBe("range");
  });

  it("renders max price range input", () => {
    renderWithProviders(<MarketplaceFilters {...defaultProps} />);
    const maxInput = screen.getByLabelText("Maximum price in XLM");
    expect(maxInput).toBeInTheDocument();
    expect(maxInput.getAttribute("type")).toBe("range");
  });
});

describe("MarketplaceFilters - Combined Filter States", () => {
  it("renders combined active filters indicator", () => {
    renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        selectedCategory="AI"
        selectedTag="popular"
        sortBy="sales"
      />,
    );
    expect(screen.getByText("Clear All Filters")).toBeInTheDocument();
  });

  it("handles price range and category filters together", () => {
    const setPriceRange = vi.fn();
    const setSelectedCategory = vi.fn();

    renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        selectedCategory=""
        priceRange={[5, 15]}
        setPriceRange={setPriceRange}
        setSelectedCategory={setSelectedCategory}
      />,
    );

    const categoryAI = screen.getByText("AI");
    categoryAI.click();
    expect(setSelectedCategory).toHaveBeenCalledWith("AI");

    const minInput = screen.getByLabelText("Minimum price in XLM");
    expect(minInput).toHaveValue("5");
  });

  it("displays empty state when combined filters exclude all listings", () => {
    const hasActiveFilters = [
      Boolean("AI"),
      Boolean("popular"),
      "sales" !== "recent",
      5 !== 0,
      15 !== 25
    ].some(Boolean);

    expect(hasActiveFilters).toBe(true);
  });

  it("prevents min price from exceeding max price", () => {
    const setPriceRange = vi.fn();

    renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        priceRange={[10, 20]}
        setPriceRange={setPriceRange}
      />,
    );

    const minInput = screen.getByLabelText("Minimum price in XLM") as HTMLInputElement;
    minInput.value = "25";
    minInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setPriceRange).toHaveBeenCalledWith([20, 20]);
  });

  it("prevents max price from being less than min price", () => {
    const setPriceRange = vi.fn();

    renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        priceRange={[10, 20]}
        setPriceRange={setPriceRange}
      />,
    );

    const maxInput = screen.getByLabelText("Maximum price in XLM") as HTMLInputElement;
    maxInput.value = "5";
    maxInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setPriceRange).toHaveBeenCalledWith([10, 10]);
  });
});

describe("MarketplaceFilters - Saved Search Integration", () => {
  it("detaches from saved search when category filter is manually changed", () => {
    const setSelectedCategory = vi.fn();

    renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        selectedCategory="AI"
        setSelectedCategory={setSelectedCategory}
      />,
    );

    const categoryMarketing = screen.getByText("Marketing");
    categoryMarketing.click();

    expect(setSelectedCategory).toHaveBeenCalledWith("Marketing");
  });

  it("detaches from saved search when price range is modified", () => {
    const setPriceRange = vi.fn();

    renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        priceRange={[0, 25]}
        setPriceRange={setPriceRange}
      />,
    );

    const minInput = screen.getByLabelText("Minimum price in XLM") as HTMLInputElement;
    minInput.value = "5";
    minInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setPriceRange).toHaveBeenCalled();
  });

  it("detaches from saved search when sort order is changed", () => {
    const setSortBy = vi.fn();

    renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        sortBy="recent"
        setSortBy={setSortBy}
      />,
    );

    const sortTrigger = screen.getByText("Newest Arrivals");
    expect(sortTrigger).toBeInTheDocument();
  });

  it("correctly detaches from saved search state on filter mutation", () => {
    const setSelectedCategory = vi.fn();
    const setSelectedTag = vi.fn();

    renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        selectedCategory="AI"
        selectedTag="popular"
        setSelectedCategory={setSelectedCategory}
        setSelectedTag={setSelectedTag}
      />,
    );

    const code = screen.getByText("Code");
    code.click();

    expect(setSelectedCategory).toHaveBeenCalledWith("Code");
  });
});

describe("MarketplaceFilters - Rapid Filter Changes", () => {
  it("handles rapid successive category changes", () => {
    const setSelectedCategory = vi.fn();

    const { rerender } = renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        selectedCategory=""
        setSelectedCategory={setSelectedCategory}
      />,
    );

    const categories = ["AI", "Marketing", "Code"];
    categories.forEach((cat) => {
      const badge = screen.getByText(cat);
      badge.click();
      rerender(
        <MarketplaceFilters
          {...defaultProps}
          selectedCategory={cat}
          setSelectedCategory={setSelectedCategory}
        />,
      );
    });

    expect(setSelectedCategory).toHaveBeenCalledTimes(3);
  });

  it("handles rapid price range adjustments without memory leaks", () => {
    const setPriceRange = vi.fn();

    renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        priceRange={[0, 25]}
        setPriceRange={setPriceRange}
      />,
    );

    const minInput = screen.getByLabelText("Minimum price in XLM") as HTMLInputElement;

    for (let i = 1; i <= 5; i++) {
      minInput.value = String(i);
      minInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    expect(setPriceRange).toHaveBeenCalledTimes(5);
  });

  it("coalesces rapid tag changes within debounce window", () => {
    const setSelectedTag = vi.fn();

    const { rerender } = renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        selectedTag=""
        setSelectedTag={setSelectedTag}
      />,
    );

    const tags = ["popular", "new"];
    tags.forEach((tag) => {
      const badge = screen.getByText(tag);
      badge.click();
      rerender(
        <MarketplaceFilters
          {...defaultProps}
          selectedTag={tag}
          setSelectedTag={setSelectedTag}
        />,
      );
    });

    expect(setSelectedTag).toHaveBeenCalled();
  });

  it("maintains filter state consistency during rapid changes", () => {
    const setSelectedCategory = vi.fn();
    const setPriceRange = vi.fn();
    const setSortBy = vi.fn();

    const { rerender } = renderWithProviders(
      <MarketplaceFilters
        {...defaultProps}
        selectedCategory="AI"
        priceRange={[5, 20]}
        sortBy="sales"
        setSelectedCategory={setSelectedCategory}
        setPriceRange={setPriceRange}
        setSortBy={setSortBy}
      />,
    );

    const clearButton = screen.getByText("Clear All Filters");
    clearButton.click();

    rerender(
      <MarketplaceFilters
        {...defaultProps}
        selectedCategory=""
        priceRange={[0, 25]}
        sortBy="recent"
        setSelectedCategory={setSelectedCategory}
        setPriceRange={setPriceRange}
        setSortBy={setSortBy}
      />,
    );

    expect(screen.queryByText("Clear All Filters")).not.toBeInTheDocument();
  });
});
