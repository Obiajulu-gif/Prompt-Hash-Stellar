import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { featuredPromptTemplates } from "@/data/featuredPrompts";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { FeaturedPrompts } from "@/components/featured-prompts";
import { Button } from "@/components/ui/button";
import FetchAllPrompts from "./FetchAllPrompts";
import { HeroAnimation } from "./HeroAnimation";
import {
  MarketplaceFilters,
  MarketplaceFiltersPanel,
} from "./MarketplaceFilters";

const categories = Array.from(
  new Set(featuredPromptTemplates.map((prompt) => prompt.category)),
);

export default function BrowsePage() {
  const [priceRange, setPriceRange] = useState([0, 25]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [sortBy, setSortBy] = useState("recent");
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedCategory) count++;
    if (searchQuery) count++;
    if (sortBy !== "recent") count++;
    if (priceRange[0] !== 0 || priceRange[1] !== 25) count++;
    return count;
  }, [selectedCategory, searchQuery, sortBy, priceRange]);
  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory("");
    setSortBy("recent");
    setPriceRange([0, 25]);
  };

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
          <MarketplaceFilters
            categories={categories}
            priceRange={priceRange}
            searchQuery={searchQuery}
            selectedCategory={selectedCategory}
            sortBy={sortBy}
            activeFilterCount={activeFilterCount}
            onSearchChange={setSearchQuery}
            onCategoryChange={setSelectedCategory}
            onPriceRangeChange={setPriceRange}
            onSortChange={setSortBy}
            onClearFilters={clearFilters}
            onOpenMobileFilters={() => setIsFilterOpen(true)}
          >
            <FetchAllPrompts
              selectedCategory={selectedCategory}
              priceRange={priceRange}
              searchQuery={searchQuery}
              sortBy={sortBy}
            />
          </MarketplaceFilters>
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
            <MarketplaceFiltersPanel
              categories={categories}
              priceRange={priceRange}
              selectedCategory={selectedCategory}
              sortBy={sortBy}
              onCategoryChange={setSelectedCategory}
              onPriceRangeChange={setPriceRange}
              onSortChange={setSortBy}
              onClearFilters={clearFilters}
            />
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
