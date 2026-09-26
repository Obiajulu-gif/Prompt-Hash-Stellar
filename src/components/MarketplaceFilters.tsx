
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

 
export interface MarketplaceFiltersProps {
  categories: string[];
  tags: string[];
  selectedCategory: string;
  setSelectedCategory: (_cat: string) => void;
  selectedTag: string;
  setSelectedTag: (tag: string) => void;
  searchQuery: string;
  setSearchQuery: (_q: string) => void;
  priceRange: [number, number];
  setPriceRange: (_r: [number, number]) => void;
  sortBy: string;
  setSortBy: (_s: string) => void;
  onClear: () => void;
}
 

const PRICE_MAX = 25;

export function MarketplaceFilters({
  categories,
  tags,
  selectedCategory,
  setSelectedCategory,
  selectedTag,
  setSelectedTag,
  priceRange,
  setPriceRange,
  sortBy,
  setSortBy,
  onClear,
}: MarketplaceFiltersProps) {
  const hasActiveFilters =
    Boolean(selectedCategory) ||
    Boolean(selectedTag) ||
    sortBy !== "recent" ||
    priceRange[0] !== 0 ||
    priceRange[1] !== PRICE_MAX;

  return (
    <div className="space-y-8">
      {/* Category chips */}
      <div className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.25em] font-bold text-slate-500">
          Category
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge
            onClick={() => setSelectedCategory("")}
            className={`cursor-pointer select-none transition-colors ${
              !selectedCategory
                ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 border-transparent"
                : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"
            }`}
          >
            All
          </Badge>
          {categories.map((cat) => (
            <Badge
              key={cat}
              onClick={() =>
                setSelectedCategory(selectedCategory === cat ? "" : cat)
              }
              className={`cursor-pointer select-none transition-colors ${
                selectedCategory === cat
                  ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 border-transparent"
                  : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"
              }`}
            >
              {cat}
            </Badge>
          ))}
        </div>
      </div>

      {tags.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] uppercase tracking-[0.25em] font-bold text-slate-500">
            Tags
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge
              onClick={() => setSelectedTag("")}
              className={`cursor-pointer select-none transition-colors ${
                !selectedTag
                  ? "bg-slate-100 text-slate-950 hover:bg-slate-200 border-transparent"
                  : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"
              }`}
            >
              All
            </Badge>
            {tags.map((tag) => (
              <Badge
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? "" : tag)}
                className={`cursor-pointer select-none transition-colors ${
                  selectedTag === tag
                    ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 border-transparent"
                    : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"
                }`}
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Price range — two independent range inputs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.25em] font-bold text-slate-500">
            Price Range
          </p>
          <span className="text-xs font-mono text-emerald-400">
            {priceRange[0]} – {priceRange[1]} XLM
          </span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="w-6">Min</span>
            <input
              type="range"
              min={0}
              max={PRICE_MAX}
              step={1}
              value={priceRange[0]}
              onChange={(e) => {
                const next = Math.min(Number(e.target.value), priceRange[1]);
                setPriceRange([next, priceRange[1]]);
              }}
              className="flex-1 accent-emerald-500"
              aria-label="Minimum price in XLM"
            />
            <span className="w-10 text-right font-mono text-slate-400">
              {priceRange[0]}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="w-6">Max</span>
            <input
              type="range"
              min={0}
              max={PRICE_MAX}
              step={1}
              value={priceRange[1]}
              onChange={(e) => {
                const next = Math.max(Number(e.target.value), priceRange[0]);
                setPriceRange([priceRange[0], next]);
              }}
              className="flex-1 accent-emerald-500"
              aria-label="Maximum price in XLM"
            />
            <span className="w-10 text-right font-mono text-slate-400">
              {priceRange[1]}
            </span>
          </div>
        </div>
      </div>

      {/* Sort */}
      <div className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.25em] font-bold text-slate-500">
          Sort By
        </p>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="border-white/5 bg-white/5 h-11 text-slate-100 transition-all hover:bg-white/10 focus:ring-emerald-500/30">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-white/10 text-slate-100">
            <SelectItem value="recent">Newest Arrivals</SelectItem>
            <SelectItem value="sales">Best Sellers</SelectItem>
            <SelectItem value="price-low">Price: Low to High</SelectItem>
            <SelectItem value="price-high">Price: High to Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Clear */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          className="w-full text-slate-400 hover:text-white hover:bg-white/5 text-xs border border-white/10 h-9"
          onClick={onClear}
          type="button"
        >
          Clear All Filters
        </Button>
      )}
    </div>
  );
}
