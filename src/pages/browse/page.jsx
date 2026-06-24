import { useMemo, useState } from "react";
import { Filter, Search, X } from "lucide-react";
import { featuredPromptTemplates } from "@/data/featuredPrompts";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { FeaturedPrompts } from "@/components/featured-prompts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketplaceFilters } from "@/components/MarketplaceFilters";
import FetchAllPrompts from "./FetchAllPrompts";
import { HeroAnimation } from "./HeroAnimation";
import { usePageMeta } from "@/lib/seo/usePageMeta";

const categories = Array.from(
  new Set(featuredPromptTemplates.map((prompt) => prompt.category)),
);
const tags = ["AI", "Creative", "Product", "Sales", "Finance", "Support"];

export default function BrowsePage() {
  usePageMeta({
    title: "Browse Prompts",
    description: "Explore AI prompts across categories. Buy verified prompt licenses secured on the Stellar blockchain.",
  });

  const [priceRange, setPriceRange] = useState([0, 25]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [sortBy, setSortBy] = useState("recent");
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedCategory) count++;
    if (selectedTag) count++;
    if (searchQuery) count++;
    if (sortBy !== "recent") count++;
    if (priceRange[0] !== 0 || priceRange[1] !== 25) count++;
    return count;
  }, [selectedCategory, selectedTag, searchQuery, sortBy, priceRange]);

  const handleClearFilters = () => {
    setSearchQuery("");
    setSelectedCategory("");
    setSelectedTag("");
    setSortBy("recent");
    setPriceRange([0, 25]);
  };

  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-emerald-500/30">
      <Navigation />

      {/* Marketplace Header */}
      <header className="relative overflow-hidden px-4 pb-12 pt-16 sm:px-6">
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

      <main className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
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
              <MarketplaceFilters
                categories={categories}
                tags={tags}
                selectedCategory={selectedCategory}
                setSelectedCategory={setSelectedCategory}
                selectedTag={selectedTag}
                setSelectedTag={setSelectedTag}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                priceRange={priceRange}
                setPriceRange={setPriceRange}
                sortBy={sortBy}
                setSortBy={setSortBy}
                onClear={handleClearFilters}
              />
            </div>
          </aside>

          <div className="flex-1 space-y-8">
            {/* Search bar */}
            <div className="flex items-stretch gap-3">
              <div className="relative flex-1 group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-emerald-400 transition-colors" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by title, creator, category, description, or tags..."
                  className="h-14 pl-12 pr-4 rounded-2xl border-white/5 bg-white/[0.03] text-base placeholder:text-slate-500 focus-visible:ring-emerald-500/20 transition-all"
                />
              </div>
              <div className="relative lg:hidden">
                <Button
                  variant="outline"
                  className="h-14 w-14 rounded-2xl border-white/10 bg-white/5"
                  onClick={() => setIsFilterOpen(true)}
                  aria-label="Open filters"
                >
                  <Filter className="h-5 w-5" />
                </Button>
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-slate-950 pointer-events-none">
                    {activeFilterCount}
                  </span>
                )}
              </div>
            </div>

            <FetchAllPrompts
              selectedCategory={selectedCategory}
              selectedTag={selectedTag}
              priceRange={priceRange}
              searchQuery={searchQuery}
              sortBy={sortBy}
            />
          </div>
        </div>
      </main>

      {/* Mobile Filter Drawer */}
      {isFilterOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            onClick={() => setIsFilterOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-full max-w-[320px] overflow-y-auto border-l border-white/10 bg-slate-900 p-6 shadow-2xl animate-in slide-in-from-right duration-300 sm:p-8">
            <div className="mb-8 flex items-center justify-between">
              <h2 className="text-xl font-bold">Filters</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsFilterOpen(false)}
                aria-label="Close filters"
              >
                <X className="h-6 w-6" />
              </Button>
            </div>
            <MarketplaceFilters
              categories={categories}
              tags={tags}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              selectedTag={selectedTag}
              setSelectedTag={setSelectedTag}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              priceRange={priceRange}
              setPriceRange={setPriceRange}
              sortBy={sortBy}
              setSortBy={setSortBy}
              onClear={handleClearFilters}
            />
            <Button
              className="mt-10 h-12 w-full bg-emerald-500 font-bold text-slate-950"
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
