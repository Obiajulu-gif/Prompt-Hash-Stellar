import type { PromptRecord } from "@/lib/stellar/promptHashClient";

/**
 * Search ranking engine that prioritizes title matches, category relevance,
 * and applies freshness decay to stale listings (#734)
 */

export interface RankingResult {
  prompt: PromptRecord;
  score: number;
  titleMatch: boolean;
  categoryMatch: boolean;
  freshnessScore: number;
}

/** Ranking signal weights and decay parameters (#734) */
const RANKING_WEIGHTS = {
  // Text relevance weights
  EXACT_TITLE: 100,
  TITLE_START: 80,
  TITLE_CONTAINS: 60,
  CATEGORY: 40,
  SELECTED_CATEGORY: 20,
  PREVIEW: 20,
  DESCRIPTION: 15,
  CREATOR: 10,
  TAGS: 10,

  // Freshness and activity weights
  VERIFIED_BOOST: 15,
  RECENT_ACTIVITY_BOOST: 10,

  // Stale listing penalties (applied as multipliers)
  STALE_MODERATE: 0.7, // 30 days inactive
  STALE_SEVERE: 0.4, // 90 days inactive
  NO_SALES: 0.9, // No sales ever
};

/** Thresholds for freshness decay (in milliseconds) */
const FRESHNESS_THRESHOLDS = {
  MODERATE_STALE_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
  SEVERE_STALE_MS: 90 * 24 * 60 * 60 * 1000, // 90 days
};

/**
 * Calculate freshness decay multiplier based on listing age and activity (#734)
 */
function calculateFreshnessMultiplier(prompt: PromptRecord): number {
  const now = Date.now();

  // Use the most recent activity timestamp available
  const lastActivityTime = prompt.updatedAt
    ? new Date(prompt.updatedAt).getTime()
    : prompt.createdAt
      ? new Date(prompt.createdAt).getTime()
      : now;

  const ageMs = now - lastActivityTime;

  // Apply decay based on age
  let multiplier = 1.0;

  if (ageMs > FRESHNESS_THRESHOLDS.SEVERE_STALE_MS) {
    multiplier *= RANKING_WEIGHTS.STALE_SEVERE;
  } else if (ageMs > FRESHNESS_THRESHOLDS.MODERATE_STALE_MS) {
    multiplier *= RANKING_WEIGHTS.STALE_MODERATE;
  }

  // Additional penalty for listings with no sales
  const salesCount = prompt.salesCount ?? 0;
  if (salesCount === 0 && ageMs > FRESHNESS_THRESHOLDS.MODERATE_STALE_MS) {
    multiplier *= RANKING_WEIGHTS.NO_SALES;
  }

  return multiplier;
}

/**
 * Calculate relevance score for a prompt based on search query
 * Title matches are weighted highest, followed by category, then other fields
 * Stale listings are decayed based on inactivity (#734)
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
      freshnessScore: 1.0,
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

  // Title match: highest weight
  if (title === normalized) {
    score += RANKING_WEIGHTS.EXACT_TITLE;
    titleMatch = true;
  } else if (title.startsWith(normalized)) {
    score += RANKING_WEIGHTS.TITLE_START;
    titleMatch = true;
  } else if (title.includes(normalized)) {
    score += RANKING_WEIGHTS.TITLE_CONTAINS;
    titleMatch = true;
  }

  // Category match: high weight
  if (category === normalized || category.includes(normalized)) {
    score += RANKING_WEIGHTS.CATEGORY;
    categoryMatch = true;
  }

  // Selected category bonus
  if (selectedCategory && prompt.category === selectedCategory) {
    score += RANKING_WEIGHTS.SELECTED_CATEGORY;
  }

  // Preview/Description match: medium weight
  if (preview.includes(normalized)) {
    score += RANKING_WEIGHTS.PREVIEW;
  }
  if (description.includes(normalized)) {
    score += RANKING_WEIGHTS.DESCRIPTION;
  }

  // Creator/Tags match: lower weight
  if (creator.includes(normalized)) {
    score += RANKING_WEIGHTS.CREATOR;
  }
  if (tags.some((tag) => tag === normalized || tag.includes(normalized))) {
    score += RANKING_WEIGHTS.TAGS;
  }

  // Verification boost (#734)
  if (prompt.verified) {
    score += RANKING_WEIGHTS.VERIFIED_BOOST;
  }

  // Recent activity boost (sales in last 30 days) (#734)
  const salesCount = prompt.salesCount ?? 0;
  if (salesCount > 0) {
    score += RANKING_WEIGHTS.RECENT_ACTIVITY_BOOST;
  }

  // Apply freshness decay to final score (#734)
  const freshnessMultiplier = calculateFreshnessMultiplier(prompt);
  const finalScore = Math.round(score * freshnessMultiplier);

  return {
    prompt,
    score: finalScore,
    titleMatch,
    categoryMatch,
    freshnessScore: freshnessMultiplier,
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
