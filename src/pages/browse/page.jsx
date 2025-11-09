"use client";

import { useState } from "react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
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
import { Filter, Search } from "lucide-react";
import FetchAllPrompts from "./FetchAllPrompts";

export default function BrowsePage() {
  const [priceRange, setPriceRange] = useState([1, 1000]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");

  return (
    <div className="min-h-screen bg-gray-950 bg-gradient-to-r from-purple-400 to-blue-500 flex flex-col">
      <Navigation />
      <main className="flex-1 container py-8">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Filters Sidebar */}
          <aside className="w-full md:w-64 space-y-6">
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filters
              </h2>
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <Select
                  value={selectedCategory}
                  onValueChange={setSelectedCategory}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="creative">Creative Writing</SelectItem>
                    <SelectItem value="coding">Coding</SelectItem>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Price Range (XLM)
                </label>
                <Slider
                  value={priceRange}
                  onValueChange={setPriceRange}
                  min={1}
                  max={1000}
                  step={1}
                />
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{priceRange[1]} XLM</span>
                  <span>{priceRange[1000]} XLM</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Sort By</label>
                <Select defaultValue="recent">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">Most Recent</SelectItem>
                    <SelectItem value="popular">Most Popular</SelectItem>
                    <SelectItem value="price-low">
                      Price: Low to High
                    </SelectItem>
                    <SelectItem value="price-high">
                      Price: High to Low
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </aside>

          {/* Prompts Grid */}
          <div className="flex-1 space-y-6">
            <div className="flex items-center gap-4">
              <Input
                placeholder="Search prompts..."
                className="max-w-md"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Button>
                <Search className="mr-2 h-4 w-4" />
                Search
              </Button>
            </div>

            <FetchAllPrompts priceRange={priceRange} />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
