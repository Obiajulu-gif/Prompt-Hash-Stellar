import { useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";
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

const categories = Array.from(
  new Set(featuredPromptTemplates.map((prompt) => prompt.category)),
);

export default function BrowsePage() {
  const [priceRange, setPriceRange] = useState([0, 25]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [sortBy, setSortBy] = useState("recent");

  const selectedCategoryLabel = useMemo(
    () => selectedCategory || "All categories",
    [selectedCategory],
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_30%),linear-gradient(180deg,_#020617,_#0f172a_45%,_#020617)] text-white">
      <Navigation />
      <main className="mx-auto flex max-w-7xl flex-col gap-12 px-6 py-10">
        <section className="grid gap-6 rounded-[2rem] border border-white/10 bg-slate-950/60 p-8 shadow-[0_32px_120px_-64px_rgba(16,185,129,0.5)] lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <p className="text-sm uppercase tracking-[0.35em] text-emerald-300">
              Browse the marketplace
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
              Buy prompt licenses on Stellar and unlock plaintext only after access is verified.
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-slate-300">
              Browse public previews, compare pricing in XLM, and unlock purchased
              prompts through the same Vercel app. Full prompt content never appears
              in public cards or browse modals.
            </p>
          </div>
          <div className="grid gap-4 rounded-[1.75rem] border border-white/10 bg-white/5 p-5 text-sm text-slate-200 sm:grid-cols-3 lg:grid-cols-1">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Filters
              </p>
              <p className="mt-2 leading-6">
                Category, text search, sort order, and XLM price range all apply to
                the live contract-backed grid below.
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Public data
              </p>
              <p className="mt-2 leading-6">
                Title, image, category, preview text, price, seller, and sales count
                are visible. Full prompt text stays encrypted.
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Unlock path
              </p>
              <p className="mt-2 leading-6">
                Wallet signs a challenge, the API checks on-chain access, then the
                server decrypts the stored ciphertext if the license exists.
              </p>
            </div>
          </div>
        </section>

        <FeaturedPrompts limit={4} title="Template previews" />

        <section className="grid gap-8 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-6 rounded-[2rem] border border-white/10 bg-slate-950/60 p-6">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-emerald-300" />
              <h2 className="text-lg font-semibold">Filters</h2>
            </div>

            <div className="space-y-3">
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Category
              </label>
              <Select value={selectedCategoryLabel} onValueChange={(value) => {
                setSelectedCategory(value === "All categories" ? "" : value);
              }}>
                <SelectTrigger className="border-white/10 bg-white/5 text-slate-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All categories">All categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Price range
              </label>
              <Slider
                value={priceRange}
                onValueChange={setPriceRange}
                min={0}
                max={25}
                step={1}
              />
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>{priceRange[0]} XLM</span>
                <span>{priceRange[1]} XLM</span>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Sort by
              </label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="border-white/10 bg-white/5 text-slate-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Most recent</SelectItem>
                  <SelectItem value="sales">Best selling</SelectItem>
                  <SelectItem value="price-low">Price: low to high</SelectItem>
                  <SelectItem value="price-high">Price: high to low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </aside>

          <div className="space-y-6">
            <div className="flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-slate-950/60 p-6 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full md:max-w-xl">
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-500" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search titles, categories, and preview text"
                  className="border-white/10 bg-white/5 pl-10 text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("");
                  setSortBy("recent");
                  setPriceRange([0, 25]);
                }}
              >
                Reset filters
              </Button>
            </div>

            <FetchAllPrompts
              selectedCategory={selectedCategory}
              priceRange={priceRange}
              searchQuery={searchQuery}
              sortBy={sortBy}
            />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
