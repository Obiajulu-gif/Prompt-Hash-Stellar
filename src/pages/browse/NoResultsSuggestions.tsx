import { PackageSearch, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  generateNoResultSuggestions,
  type SearchSuggestion,
} from "@/lib/search/rankingEngine";
import type { PromptRecord } from "@/lib/stellar/promptHashClient";

export interface NoResultsSuggestionsProps {
  allPrompts: PromptRecord[];
  searchQuery: string;
  selectedCategory: string;
  selectedTag: string;
  onCategoryClick: (category: string) => void;
  onTagClick: (tag: string) => void;
  onClearFilters: () => void;
}

export function NoResultsSuggestions({
  allPrompts,
  searchQuery,
  selectedCategory,
  selectedTag,
  onCategoryClick,
  onTagClick,
  onClearFilters,
}: NoResultsSuggestionsProps) {
  const suggestions = generateNoResultSuggestions(
    allPrompts,
    searchQuery,
    selectedCategory,
    selectedTag,
  );

  const handleSuggestionClick = (suggestion: SearchSuggestion) => {
    if (suggestion.type === "category") {
      const category = suggestion.action.replace("category:", "");
      onCategoryClick(category);
    } else if (suggestion.type === "tag") {
      const tag = suggestion.action.replace("tag:", "");
      onTagClick(tag);
    } else if (suggestion.type === "clear") {
      onClearFilters();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
      <div className="p-4 rounded-full bg-slate-900 border border-white/5">
        <PackageSearch className="h-8 w-8 text-slate-500" />
      </div>

      <div className="space-y-2 max-w-[320px]">
        <h3 className="text-lg font-semibold">No prompts found</h3>
        <p className="text-slate-500 text-sm">
          {searchQuery
            ? "We couldn't find any prompts matching your search."
            : "Try adjusting your filters or search terms to find what you're looking for."}
        </p>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="space-y-3 w-full max-w-[300px]">
          <p className="text-xs font-semibold uppercase text-slate-500 tracking-widest">
            Try exploring
          </p>

          <div className="flex flex-col gap-2">
            {suggestions.map((suggestion, index) => (
              <Button
                key={index}
                variant="outline"
                className="justify-between group border-white/10 bg-white/[0.03] hover:bg-white/[0.08] h-auto py-3 px-4 text-left"
                onClick={() => handleSuggestionClick(suggestion)}
              >
                <span className="flex-1 font-medium text-sm">
                  {suggestion.label}
                </span>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-400 transition-colors ml-2 shrink-0" />
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Alternative action */}
      <div className="pt-4 space-y-2">
        <p className="text-xs text-slate-600">or</p>
        <Button
          variant="ghost"
          className="text-emerald-400 hover:text-emerald-300"
          onClick={onClearFilters}
        >
          View all prompts
        </Button>
      </div>
    </div>
  );
}
