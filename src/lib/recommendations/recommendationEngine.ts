export interface PromptListing {
  id: string;
  title: string;
  category: string;
  price: number;
  rating?: number;
  salesCount?: number;
  createdAt: string | Date;
  updatedAt?: string | Date;
  ownerId: string;
  ownerWallet?: string;
  creatorTrustScore?: number;
  creatorRating?: number;
  listingStatus?: "draft" | "ready" | "published" | "archived";
  isActive?: boolean;
  similarityFlag?: "clean" | "suspicious" | "highly_similar";
  integrityStatus?: "pending" | "ok" | "corrupted" | "missing" | "unreachable";
  isRestricted?: boolean;
  isHidden?: boolean;
}

export interface RecommendationFilterOptions {
  userWallet?: string;
  userId?: string;
  purchasedPromptIds?: string[] | Set<string>;
  minCreatorTrustScore?: number;
  minCreatorRating?: number;
  maxStalenessDays?: number;
  limit?: number;
  categoryDiversity?: boolean;
}

const DEFAULT_MIN_CREATOR_TRUST = 2.5;
const DEFAULT_MAX_STALENESS_DAYS = 180;

/**
 * Checks if a single prompt listing meets the eligibility criteria for recommendation
 */
export function isPromptEligibleForRecommendation(
  prompt: PromptListing,
  options: RecommendationFilterOptions = {},
): boolean {
  // 1. Must be active and published
  if (prompt.isActive === false) return false;
  if (prompt.listingStatus && prompt.listingStatus !== "published") return false;
  if (prompt.isHidden || prompt.isRestricted) return false;

  // 2. Policy & Integrity checks: exclude plagiarized, suspicious, or corrupted prompts
  if (prompt.similarityFlag === "highly_similar") return false;
  if (prompt.integrityStatus === "corrupted" || prompt.integrityStatus === "missing") {
    return false;
  }

  // 3. User Ownership check: do not recommend user's own prompt
  if (options.userId && prompt.ownerId && prompt.ownerId === options.userId) {
    return false;
  }
  if (
    options.userWallet &&
    prompt.ownerWallet &&
    prompt.ownerWallet.toLowerCase() === options.userWallet.toLowerCase()
  ) {
    return false;
  }

  // 4. Purchased check: do not recommend already purchased prompts
  if (options.purchasedPromptIds) {
    const purchasedSet =
      options.purchasedPromptIds instanceof Set
        ? options.purchasedPromptIds
        : new Set(options.purchasedPromptIds);
    if (purchasedSet.has(prompt.id)) {
      return false;
    }
  }

  // 5. Creator Trust check
  const minTrust = options.minCreatorTrustScore ?? DEFAULT_MIN_CREATOR_TRUST;
  if (
    typeof prompt.creatorTrustScore === "number" &&
    prompt.creatorTrustScore < minTrust
  ) {
    return false;
  }

  const minRating = options.minCreatorRating ?? 2.0;
  if (
    typeof prompt.creatorRating === "number" &&
    prompt.creatorRating < minRating
  ) {
    return false;
  }

  // 6. Staleness check: exclude prompts older than maxStalenessDays without recent updates
  const maxStaleness = options.maxStalenessDays ?? DEFAULT_MAX_STALENESS_DAYS;
  const lastActiveDate = new Date(
    prompt.updatedAt || prompt.createdAt || Date.now(),
  ).getTime();
  const daysOld = (Date.now() - lastActiveDate) / (1000 * 60 * 60 * 24);
  if (daysOld > maxStaleness) {
    return false;
  }

  return true;
}

/**
 * Calculates a deterministic recommendation ranking score for an eligible prompt
 */
export function calculateRecommendationScore(prompt: PromptListing): number {
  const ratingScore = (prompt.rating ?? 4.0) * 20; // 0-100
  const trustScore = (prompt.creatorTrustScore ?? prompt.creatorRating ?? 4.0) * 15; // 0-75
  const popularityScore = Math.min((prompt.salesCount ?? 0) * 5, 50); // 0-50

  const createdTime = new Date(prompt.createdAt).getTime();
  const daysOld = Math.max(0, (Date.now() - createdTime) / (1000 * 60 * 60 * 24));
  const recencyBoost = Math.max(0, 30 - daysOld * 0.5); // 0-30

  return ratingScore + trustScore + popularityScore + recencyBoost;
}

/**
 * Filters and ranks prompts for personalized recommendations with category diversity
 */
export function getRecommendedPrompts(
  prompts: PromptListing[],
  options: RecommendationFilterOptions = {},
): PromptListing[] {
  // Step 1: Filter eligible prompts
  const eligible = prompts.filter((p) =>
    isPromptEligibleForRecommendation(p, options),
  );

  // Step 2: Calculate deterministic scores and sort descending
  const scored = eligible.map((prompt) => ({
    prompt,
    score: calculateRecommendationScore(prompt),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.prompt.id.localeCompare(b.prompt.id); // deterministic tie-breaker
  });

  const sortedPrompts = scored.map((s) => s.prompt);

  // Step 3: Enforce category diversity if requested
  const limit = options.limit ?? 10;
  if (!options.categoryDiversity || sortedPrompts.length <= 1) {
    return sortedPrompts.slice(0, limit);
  }

  // Interleave across categories to avoid single-category saturation
  const categorized = new Map<string, PromptListing[]>();
  for (const prompt of sortedPrompts) {
    const cat = prompt.category || "General";
    if (!categorized.has(cat)) {
      categorized.set(cat, []);
    }
    categorized.get(cat)!.push(prompt);
  }

  const result: PromptListing[] = [];
  const categoryQueues = Array.from(categorized.values());

  let added = true;
  while (added && result.length < limit) {
    added = false;
    for (const queue of categoryQueues) {
      if (queue.length > 0 && result.length < limit) {
        result.push(queue.shift()!);
        added = true;
      }
    }
  }

  return result;
}
