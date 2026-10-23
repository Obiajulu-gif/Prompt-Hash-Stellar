import Prompt from "../models/Prompt";
import {
  cacheGetJson,
  cacheSetJson,
  cacheDelPattern,
  CACHE_KEYS,
  DEFAULT_TTL_SECONDS,
  CATEGORY_TTL_SECONDS,
} from "../services/cacheService";
import { resolveCategory } from "../services/categoryTaxonomyService";
import {
  buildPublicVisibilityFilter,
  stripSensitivePromptFields,
} from "../services/visibilityService.js";

export interface SearchFilters {
  query?: string;
  category?: string;
  tags?: string | string[];
  version?: number;
  minVersion?: number;
  minCreatorRating?: number;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: "recent" | "price-low" | "price-high" | "sales" | "rating" | "trust";
  page?: number;
  limit?: number;
}

export interface SearchResponse {
  prompts: any[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

/**
 * Hard ceiling on `limit` for any search read path (#983).
 *
 * The route forwards `Number(req.query.limit)` straight through, so without
 * this clamp `GET /api/search/prompts?limit=100000` asks Mongo for 100k
 * documents in one response — and, because the deep-search policy only charges
 * the pagination *offset* (`(page-1)*limit`), `page=1&limit=100000` costs 0
 * and sails past the 500-offset ceiling. Clamping here (the single choke point
 * every caller funnels through) bounds the work while staying inside the page
 * size already documented for the marketplace and OpenAPI (`PAGE_SIZE_MAX`).
 */
export const SEARCH_PAGE_SIZE_MAX = 100;

/** Clamp a caller-supplied page size into `[1, SEARCH_PAGE_SIZE_MAX]`. */
export function clampSearchLimit(limit: number | undefined, fallback = 20): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), SEARCH_PAGE_SIZE_MAX);
}

/**
 * Search prompts with advanced filtering (tags, version, creator trust) and pagination (#681)
 */
export async function searchPrompts(
  filters: SearchFilters,
): Promise<SearchResponse> {
  const {
    query = "",
    category,
    tags,
    version,
    minVersion,
    minPrice = 0,
    maxPrice = 1000000,
    sortBy = "recent",
    page = 1,
    limit: rawLimit = 20,
  } = filters;

  // Worst-case request work is bounded regardless of what the caller sent.
  const limit = clampSearchLimit(rawLimit);
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;

  const cacheKey = CACHE_KEYS.searchResults(
    `q=${query}&cat=${category ?? ""}&tags=${Array.isArray(tags) ? tags.join(",") : (tags ?? "")}&ver=${version ?? ""}&minVer=${minVersion ?? ""}&minP=${minPrice}&maxP=${maxPrice}&sort=${sortBy}&p=${safePage}&l=${limit}&minR=${filters.minCreatorRating ?? ""}`,
  );
  const cached = await cacheGetJson<SearchResponse>(cacheKey);
  if (cached) {
    return cached;
  }

  // Build the base query with comprehensive public visibility boundaries
  const baseQuery: any = {
    ...buildPublicVisibilityFilter(),
    price: { $gte: minPrice, $lte: maxPrice },
  };

  // Add category filter if specified (with redirect support)
  if (category && category !== "") {
    // Resolve category slug to active category (following redirects)
    const resolvedCategory = await resolveCategory(category);
    if (resolvedCategory) {
      baseQuery.category = resolvedCategory.displayName;
    } else {
      // Category not found or deprecated; return empty results
      return {
        prompts: [],
        total: 0,
        page: safePage,
        totalPages: 0,
        hasMore: false,
      };
    }
  }

  // Add tags filter if specified
  if (tags) {
    const tagList = Array.isArray(tags) ? tags : [tags];
    baseQuery.tags = {
      $in: tagList.map((t) => new RegExp(`^${t.trim()}$`, "i")),
    };
  }

  // Add version signals filter
  if (version !== undefined) {
    baseQuery.currentVersionIndex = version;
  } else if (minVersion !== undefined) {
    baseQuery.currentVersionIndex = { $gte: minVersion };
  }

  // Add text search if query is provided
  let searchQuery = Prompt.find(baseQuery);

  if (query && query.trim() !== "") {
    const searchRegex = new RegExp(query.trim(), "i");
    searchQuery = searchQuery.or([
      { title: searchRegex },
      { content: searchRegex },
      { category: searchRegex },
      { description: searchRegex },
      { tags: searchRegex },
    ]);
  }

  // Get total count for pagination
  const total = await Prompt.countDocuments(searchQuery.getFilter());

  // Apply sorting
  let sortOptions: any;
  switch (sortBy) {
    case "price-low":
      sortOptions = { price: 1, _id: 1 };
      break;
    case "price-high":
      sortOptions = { price: -1, _id: 1 };
      break;
    case "sales":
      sortOptions = { salesCount: -1, rating: -1, createdAt: -1, _id: 1 };
      break;
    case "rating":
    case "trust":
      sortOptions = { rating: -1, salesCount: -1, createdAt: -1, _id: 1 };
      break;
    case "recent":
    default:
      sortOptions = { createdAt: -1, _id: 1 };
      break;
  }

  // Execute query with pagination
  let prompts = await searchQuery
    .sort(sortOptions)
    .skip((safePage - 1) * limit)
    .limit(limit)
    .populate("owner", "walletAddress username rating")
    .lean();

  // Filter by creator trust / rating if specified
  if (filters.minCreatorRating !== undefined) {
    const minRating = Number(filters.minCreatorRating);
    prompts = prompts.filter(
      (p: any) => p.owner?.rating === undefined || p.owner?.rating >= minRating,
    );
  }

  const totalPages = Math.ceil(total / limit);
  const hasMore = safePage < totalPages;

  const sanitizedPrompts = prompts.map((p: any) => stripSensitivePromptFields(p));

  const result: SearchResponse = {
    prompts: sanitizedPrompts,
    total,
    page: safePage,
    totalPages,
    hasMore,
  };

  await cacheSetJson(cacheKey, result, DEFAULT_TTL_SECONDS);

  return result;
}

/**
 * Rebuilds the search index deterministically across all published prompts (#681)
 */
export async function rebuildSearchIndex(): Promise<{
  totalIndexed: number;
  success: boolean;
  rebuiltAt: string;
}> {
  const publishedPrompts = await Prompt.find({
    listingStatus: "published",
    isActive: true,
  });

  const promptArray = Array.isArray(publishedPrompts) ? publishedPrompts : [];

  const bulkOps = promptArray.map((prompt) => ({
    updateOne: {
      filter: { _id: prompt._id },
      update: {
        $set: {
          searchIndexStatus: "synced",
          searchIndexError: null,
          lastIndexedAt: new Date(),
        },
      },
    },
  }));

  if (bulkOps.length > 0) {
    await Prompt.bulkWrite(bulkOps);
  }

  await Promise.all([
    cacheDelPattern("prompts:*"),
    cacheDelPattern("search:*"),
  ]);

  return {
    totalIndexed: promptArray.length,
    success: true,
    rebuiltAt: new Date().toISOString(),
  };
}

/**
 * Get search suggestions based on query
 */
export async function getSearchSuggestions(query: string, limit: number = 5) {
  if (!query || query.trim().length < 2) {
    return { titles: [], categories: [], tags: [] };
  }

  // Suggestions are an autocomplete path: they fire on every keystroke, so the
  // per-request work stays tightly bounded (#983).
  const safeLimit = clampSearchLimit(limit, 5);

  const normalized = query.trim().toLowerCase();
  const cacheKey = CACHE_KEYS.searchSuggestions(`${normalized}:${safeLimit}`);
  const cached = await cacheGetJson<{ titles: string[]; categories: string[] }>(cacheKey);
  if (cached) {
    return cached;
  }

  const searchRegex = new RegExp(query.trim(), "i");
  const publicFilter = buildPublicVisibilityFilter();

  const [titles, categories] = await Promise.all([
    Prompt.find({ title: searchRegex, ...publicFilter })
      .select("title")
      .limit(safeLimit)
      .lean(),
    Prompt.distinct("category", { category: searchRegex, ...publicFilter }).then(
      (cats: string[]) => cats.slice(0, safeLimit),
    ),
  ]);

  const result = {
    titles: titles.map((p: any) => p.title),
    categories,
  };

  await cacheSetJson(cacheKey, result, DEFAULT_TTL_SECONDS);

  return result;
}

/**
 * Get available categories with counts
 */
export async function getCategoriesWithCounts() {
  const cacheKey = CACHE_KEYS.categories();
  const cached = await cacheGetJson<{ name: string; count: number }[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const categories = await Prompt.aggregate([
    { $match: buildPublicVisibilityFilter() },
    { $group: { _id: "$category", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const result = categories.map((cat: any) => ({
    name: cat._id,
    count: cat.count,
  }));

  await cacheSetJson(cacheKey, result, CATEGORY_TTL_SECONDS);

  return result;
}

/**
 * Get featured/top prompts
 */
export async function getFeaturedPrompts(limit: number = 6) {
  // Bounded like the rest of the read paths (#983).
  const safeLimit = clampSearchLimit(limit, 6);
  const cacheKey = CACHE_KEYS.featuredPrompts(safeLimit);
  const cached = await cacheGetJson<any[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const prompts = await Prompt.find(buildPublicVisibilityFilter())
    .sort({ salesCount: -1, rating: -1 })
    .limit(safeLimit)
    .populate("owner", "walletAddress username rating")
    .lean();

  const sanitizedPrompts = prompts.map((p: any) => stripSensitivePromptFields(p));

  await cacheSetJson(cacheKey, sanitizedPrompts, DEFAULT_TTL_SECONDS);

  return sanitizedPrompts;
}

