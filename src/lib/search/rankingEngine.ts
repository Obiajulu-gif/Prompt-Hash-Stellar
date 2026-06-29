import type { PromptRecord } from "@/lib/stellar/promptHashClient";

/**
 * Search ranking engine that prioritizes title matches and category relevance
 */

export interface RankingResult {
  prompt: PromptRecord;
  score: number;
  titleMatch: boolean;
  categoryMatch: boolean;
}

/**
 * Calculate relevance score for a prompt based on search query
 * Title matches are weighted highest, followed by category, then other fields
 */
export function calculateRelevanceScore(
  prompt: PromptRecord,
  searchQuery: string,
  selectedCategory: string,
): RankingResult {
  const normalized = searchQuery.toLowerCase().trim();

  if (!normalized) {
    return {
      prompt,
      score: 0,
      titleMatch: false,
      categoryMatch: false,
    };
  }

  let score = 0;
  let titleMatch = false;
  let categoryMatch = false;

  const title = prompt.title.toLowerCase();
  const category = prompt.category.toLowerCase();
  const preview = prompt.previewText.toLowerCase();
  const description = (prompt.description || "").toLowerCase();
  const creator = prompt.creator.toLowerCase();
  const tags = (prompt.tags || []).map((t) => t.toLowerCase());

  // Title match: highest weight (100 points for exact, 80 for start, 60 for contains)
  if (title === normalized) {
    score += 100;
    titleMatch = true;
  } else if (title.startsWith(normalized)) {
    score += 80;
    titleMatch = true;
  } else if (title.includes(normalized)) {
    score += 60;
    titleMatch = true;
  }

  // Category match: high weight (40 points)
  if (category === normalized || category.includes(normalized)) {
    score += 40;
    categoryMatch = true;
  }

  // Selected category bonus (20 points if prompt matches user's selected category filter)
  if (selectedCategory && prompt.category === selectedCategory) {
    score += 20;
  }

  // Preview/Description match: medium weight (20 points)
  if (preview.includes(normalized)) {
    score += 20;
  }
  if (description.includes(normalized)) {
    score += 15;
  }

  // Creator/Tags match: lower weight (10 points each)
  if (creator.includes(normalized)) {
    score += 10;
  }
  if (tags.some((tag) => tag === normalized || tag.includes(normalized))) {
    score += 10;
  }

  return {
    prompt,
    score,
    titleMatch,
    categoryMatch,
  };
}

/**
 * Rank prompts based on relevance to search query
 */
export function rankPrompts(
  prompts: PromptRecord[],
  searchQuery: string,
  selectedCategory: string,
): PromptRecord[] {
  if (!searchQuery.trim()) {
    return prompts;
  }

  const ranked = prompts.map((prompt) =>
    calculateRelevanceScore(prompt, searchQuery, selectedCategory),
  );

  // Sort by score descending (higher relevance first)
  return ranked.sort((a, b) => b.score - a.score).map((r) => r.prompt);
}

/**
 * Generate suggestions for empty search results
 */
export interface SearchSuggestion {
  type: "category" | "tag" | "clear";
  label: string;
  action: string;
}

export function generateNoResultSuggestions(
  allPrompts: PromptRecord[],
  _searchQuery: string,
  selectedCategory: string,
  selectedTag: string,
): SearchSuggestion[] {
  const suggestions: SearchSuggestion[] = [];

  // If user has filters applied, suggest clearing them
  if (selectedCategory || selectedTag) {
    suggestions.push({
      type: "clear",
      label: "Clear filters",
      action: "clear-filters",
    });
  }

  // Get popular categories from all prompts
  const categoryMap = new Map<string, number>();
  allPrompts.forEach((prompt) => {
    categoryMap.set(
      prompt.category,
      (categoryMap.get(prompt.category) || 0) + 1,
    );
  });

  // Suggest top 3 categories (excluding currently selected one)
  const topCategories = Array.from(categoryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .filter(([cat]) => cat !== selectedCategory)
    .map(([category]) => ({
      type: "category" as const,
      label: `Browse "${category}"`,
      action: `category:${category}`,
    }));

  suggestions.push(...topCategories);

  // Get popular tags from all prompts
  const tagMap = new Map<string, number>();
  allPrompts.forEach((prompt) => {
    (prompt.tags || []).forEach((tag) => {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    });
  });

  // Suggest top 2 tags (excluding currently selected one)
  const topTags = Array.from(tagMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .filter(([tag]) => tag !== selectedTag)
    .map(([tag]) => ({
      type: "tag" as const,
      label: `Browse "${tag}" tag`,
      action: `tag:${tag}`,
    }));

  suggestions.push(...topTags);

  return suggestions;
}
