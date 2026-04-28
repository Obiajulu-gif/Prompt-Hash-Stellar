import type { ReactNode } from "react";
import { Filter, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface MarketplaceFiltersProps {
  children: ReactNode;
  categories: string[];
  priceRange: number[];
  searchQuery: string;
  selectedCategory: string;
  sortBy: string;
  activeFilterCount: number;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onPriceRangeChange: (value: number[]) => void;
  onSortChange: (value: string) => void;
  onClearFilters: () => void;
  onOpenMobileFilters: () => void;
}

interface FilterPanelProps {
  categories: string[];
  priceRange: number[];
  selectedCategory: string;
  sortBy: string;
  onCategoryChange: (value: string) => void;
  onPriceRangeChange: (value: number[]) => void;
  onSortChange: (value: string) => void;
  onClearFilters: () => void;
}

const SORT_OPTIONS = [
  { value: "recent", label: "Most Recent" },
  { value: "sales", label: "Sales Count" },
  { value: "price-low", label: "Price: Low to High" },
  { value: "price-high", label: "Price: High to Low" },
];

function FilterPanel({
  categories,
  priceRange,
  selectedCategory,
  sortBy,
  onCategoryChange,
  onPriceRangeChange,
  onSortChange,
  onClearFilters,
}: FilterPanelProps) {
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <label className="text-[10px] uppercase tracking-[0.25em] font-bold text-slate-500">
          Categories
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onCategoryChange("")}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              !selectedCategory
                ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
                : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white",
            )}
          >
            All
          </button>
          {categories.map((category) => {
            const isSelected = selectedCategory === category;

            return (
              <button
                key={category}
                type="button"
                onClick={() => onCategoryChange(category)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  isSelected
                    ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
                    : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white",
                )}
              >
                {category}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-[0.25em] font-bold text-slate-500">
            Price Range
          </label>
          <span className="text-xs font-mono text-emerald-400">
            {priceRange[0]} - {priceRange[1]} XLM
          </span>
        </div>
        <Slider
          value={priceRange}
          onValueChange={onPriceRangeChange}
          min={0}
          max={25}
          step={1}
          className="py-4"
        />
      </div>

      <div className="space-y-3">
        <label className="text-[10px] uppercase tracking-[0.25em] font-bold text-slate-500">
          Sort By
        </label>
        <Select value={sortBy} onValueChange={onSortChange}>
          <SelectTrigger className="border-white/5 bg-white/5 h-11 text-slate-100 transition-all hover:bg-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-white/10 text-white">
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        variant="ghost"
        className="w-full text-slate-400 hover:text-white hover:bg-white/5 text-xs"
        onClick={onClearFilters}
      >
        Clear All Filters
      </Button>
    </div>
  );
}

export function MarketplaceFilters({
  children,
  categories,
  priceRange,
  searchQuery,
  selectedCategory,
  sortBy,
  activeFilterCount,
  onSearchChange,
  onCategoryChange,
  onPriceRangeChange,
  onSortChange,
  onClearFilters,
  onOpenMobileFilters,
}: MarketplaceFiltersProps) {
  return (
    <>
      <aside className="hidden lg:block w-72 shrink-0">
        <div className="sticky top-24 p-6 rounded-3xl border border-white/5 bg-white/[0.02] backdrop-blur-xl">
          <div className="flex items-center gap-2 mb-8">
            <Filter className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold tracking-wide uppercase">
              Filters
            </h2>
          </div>
          <FilterPanel
            categories={categories}
            priceRange={priceRange}
            selectedCategory={selectedCategory}
            sortBy={sortBy}
            onCategoryChange={onCategoryChange}
            onPriceRangeChange={onPriceRangeChange}
            onSortChange={onSortChange}
            onClearFilters={onClearFilters}
          />
        </div>
      </aside>

      <div className="flex-1 space-y-8">
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-emerald-400 transition-colors" />
              <Input
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search by title, preview, creator, or category..."
                aria-label="Search marketplace prompts"
                className="h-14 pl-12 pr-4 rounded-2xl border-white/5 bg-white/[0.03] text-base placeholder:text-slate-500 focus-visible:ring-emerald-500/20 transition-all"
              />
            </div>
            <Button
              variant="outline"
              className="relative lg:hidden h-14 w-14 rounded-2xl border-white/10 bg-white/5"
              onClick={onOpenMobileFilters}
              aria-label="Open filters"
            >
              <Filter className="h-5 w-5" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-slate-950">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">
              Categories
            </Badge>
            <button
              type="button"
              onClick={() => onCategoryChange("")}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                !selectedCategory
                  ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
                  : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white",
              )}
            >
              All
            </button>
            {categories.map((category) => {
              const isSelected = selectedCategory === category;

              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => onCategoryChange(category)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    isSelected
                      ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
                      : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white",
                  )}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>

        {children}
      </div>
    </>
  );
}

export function MarketplaceFiltersPanel(props: FilterPanelProps) {
  return <FilterPanel {...props} />;
}
