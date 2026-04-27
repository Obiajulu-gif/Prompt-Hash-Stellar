import { useMemo, useState } from "react";
import { Filter, Search, X } from "lucide-react";
import { featuredPromptTemplates } from "@/data/featuredPrompts";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { FeaturedPrompts } from "@/components/featured-prompts";
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
import FetchAllPrompts from "./FetchAllPrompts";
import { HeroAnimation } from "./HeroAnimation";

const categories = Array.from(
  new Set(featuredPromptTemplates.map((prompt) => prompt.category)),
);

export default function BrowsePage() {
  const [priceRange, setPriceRange] = useState([0, 25]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [sortBy, setSortBy] = useState("recent");
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const selectedCategoryLabel = useMemo(
    () => selectedCategory || "All categories",
    [selectedCategory],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedCategory) count++;
    if (searchQuery) count++;
    if (sortBy !== "recent") count++;
    if (priceRange[0] !== 0 || priceRange[1] !== 25) count++;
    return count;
  }, [selectedCategory, searchQuery, sortBy, priceRange]);

  const FilterContent = () => (
    <div className="space-y-8">
      <div className="space-y-3">
        <label className="text-[10px] uppercase tracking-[0.25em] font-bold text-slate-500">
          Category
        </label>
        <Select
          value={selectedCategoryLabel}
          onValueChange={(value) => {
            setSelectedCategory(value === "All categories" ? "" : value);
          }}
        >
          <SelectTrigger className="border-white/5 bg-white/5 h-11 text-slate-100 transition-all hover:bg-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-white/10 text-white">
            <SelectItem value="All categories">All categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          onValueChange={setPriceRange}
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
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="border-white/5 bg-white/5 h-11 text-slate-100 transition-all hover:bg-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-white/10 text-white">
            <SelectItem value="recent">Newest Arrivals</SelectItem>
            <SelectItem value="sales">Best Sellers</SelectItem>
            <SelectItem value="price-low">Price: Low to High</SelectItem>
            <SelectItem value="price-high">Price: High to Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button
        variant="ghost"
        className="w-full text-slate-400 hover:text-white hover:bg-white/5 text-xs"
        onClick={() => {
          setSearchQuery("");
          setSelectedCategory("");
          setSortBy("recent");
          setPriceRange([0, 25]);
        }}
      >
        Clear All Filters
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-emerald-500/30">
      <Navigation />

      {/* Marketplace Header */}
      <header className="relative pt-16 pb-12 overflow-hidden px-6">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[300px] bg-emerald-500/10 blur-[120px] pointer-events-none" />

        <div className="mx-auto max-w-7xl relative">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <div className="max-w-3xl flex flex-col items-center lg:items-start text-center lg:text-left mx-auto lg:mx-0">
              <h1 className="text-4xl font-bold tracking-tight sm:text-6xl mb-6 bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent leading-[1.1]">
                Discover Premium <br />
                Prompt Licenses
              </h1>

              <p className="text-lg text-slate-400 leading-relaxed max-w-2xl mb-8">
                Secure, wallet-verified marketplace for high-performance AI
                prompts. Own the license, settle in XLM, and unlock content
                instantly.
              </p>

              <div className="flex gap-4 justify-center lg:justify-start w-full">
                <Button className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold h-12 px-8 rounded-xl">
                  Start Exploring
                </Button>
              </div>
            </div>

            {/* Right/Bottom Animation */}
            <div className="flex justify-center lg:justify-end items-center">
              <HeroAnimation />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-24">
        {/* Curated Section */}
        <div className="mb-16">
          <FeaturedPrompts limit={4} title="Editor's Choice" />
        </div>

        {/* Marketplace Grid System */}
        <div className="flex flex-col lg:flex-row gap-10">
          {/* Desktop Sidebar */}
          <aside className="hidden lg:block w-72 shrink-0">
            <div className="sticky top-24 p-6 rounded-3xl border border-white/5 bg-white/[0.02] backdrop-blur-xl">
              <div className="flex items-center gap-2 mb-8">
                <Filter className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-semibold tracking-wide uppercase">
                  Filters
                </h2>
              </div>
              <FilterContent />
            </div>
          </aside>

          <div className="flex-1 space-y-8">
            {/* Search and Mobile Toggle */}
            <div className="flex gap-3">
              <div className="relative flex-1 group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-emerald-400 transition-colors" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by prompt title or keyword..."
                  className="h-14 pl-12 pr-4 rounded-2xl border-white/5 bg-white/[0.03] text-base placeholder:text-slate-500 focus-visible:ring-emerald-500/20 transition-all"
                />
              </div>
              <Button
                variant="outline"
                className="lg:hidden h-14 w-14 rounded-2xl border-white/10 bg-white/5"
                onClick={() => setIsFilterOpen(true)}
              >
                <Filter className="h-5 w-5" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-slate-950">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </div>

            <FetchAllPrompts
              selectedCategory={selectedCategory}
              priceRange={priceRange}
              searchQuery={searchQuery}
              sortBy={sortBy}
            />
          </div>
        </div>
      </main>

      {/* Mobile Filter Drawer Overlay */}
      {isFilterOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            onClick={() => setIsFilterOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-full max-w-[320px] bg-slate-900 border-l border-white/10 p-8 shadow-2xl animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between mb-10">
              <h2 className="text-xl font-bold">Filters</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsFilterOpen(false)}
              >
                <X className="h-6 w-6" />
              </Button>
            </div>
            <FilterContent />
            <Button
              className="w-full mt-12 h-12 bg-emerald-500 text-slate-950 font-bold"
              onClick={() => setIsFilterOpen(false)}
            >
              Show Results
            </Button>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
