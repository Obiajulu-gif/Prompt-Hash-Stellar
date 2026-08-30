import Prompt from "../models/Prompt";
import { cacheDelPattern } from "../services/cacheService";

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
 * Search prompts with advanced filtering (tags, version, creator trust) and pagination (#681)
 */
export async function searchPrompts(filters: SearchFilters): Promise<SearchResponse> {
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
    limit = 20,
  } = filters;

  // Build the base query
  const baseQuery: any = {
    isActive: true,
    listingStatus: "published",
    price: { $gte: minPrice, $lte: maxPrice },
    similarityFlag: { $ne: "highly_similar" },
    integrityStatus: { $nin: ["corrupted", "missing"] },
  };

  // Add category filter if specified
  if (category && category !== "") {
    baseQuery.category = category;
  }

  // Add tags filter if specified
  if (tags) {
    const tagList = Array.isArray(tags) ? tags : [tags];
    baseQuery.tags = { $in: tagList.map((t) => new RegExp(`^${t.trim()}$`, "i")) };
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
      sortOptions = { price: 1 };
      break;
    case "price-high":
      sortOptions = { price: -1 };
      break;
    case "sales":
      sortOptions = { salesCount: -1 };
      break;
    case "rating":
    case "trust":
      sortOptions = { rating: -1, salesCount: -1 };
      break;
    case "recent":
    default:
      sortOptions = { createdAt: -1 };
      break;
  }

  // Execute query with pagination
  let prompts = await searchQuery
    .sort(sortOptions)
    .skip((page - 1) * limit)
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
  const hasMore = page < totalPages;

  return {
    prompts,
    total,
    page,
    totalPages,
    hasMore,
  };
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

  const bulkOps = publishedPrompts.map((prompt) => ({
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

  await cacheDelPattern("prompts:list:*");

  return {
    totalIndexed: publishedPrompts.length,
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

  const searchRegex = new RegExp(query.trim(), "i");

  const [titles, categories] = await Promise.all([
    Prompt.find({ title: searchRegex, isActive: true })
      .select("title")
      .limit(limit)
      .lean(),
    Prompt.distinct("category", { category: searchRegex, isActive: true }).then((cats: string[]) =>
      cats.slice(0, limit),
    ),
  ]);

  return {
    titles: titles.map((p: any) => p.title),
    categories,
  };
}

/**
 * Get available categories with counts
 */
export async function getCategoriesWithCounts() {
  const categories = await Prompt.aggregate([
    { $match: { isActive: true, listingStatus: "published" } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  return categories.map((cat: any) => ({
    name: cat._id,
    count: cat.count,
  }));
}

/**
 * Get featured/top prompts
 */
export async function getFeaturedPrompts(limit: number = 6) {
  const prompts = await Prompt.find({
    isActive: true,
    listingStatus: "published",
  })
    .sort({ salesCount: -1, rating: -1 })
    .limit(limit)
    .populate("owner", "walletAddress username rating")
    .lean();

  return prompts;
}
