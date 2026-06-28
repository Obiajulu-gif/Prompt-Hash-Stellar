import express, { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import {
  searchPrompts,
  getSearchSuggestions,
  getCategoriesWithCounts,
  getFeaturedPrompts,
} from "../controllers/searchController";

const router = express.Router();

/**
 * GET /api/search/prompts
 * Search prompts with advanced filtering and pagination
 * Query params:
 * - query: search string
 * - category: filter by category
 * - minPrice: minimum price
 * - maxPrice: maximum price
 * - sortBy: sort order (recent, price-low, price-high, sales, rating)
 * - page: page number
 * - limit: items per page
 */
router.get(
  "/prompts",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      query,
      category,
      minPrice,
      maxPrice,
      sortBy,
      page = "1",
      limit = "20",
    } = req.query;

    const result = await searchPrompts({
      query: query as string,
      category: category as string,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      sortBy: sortBy as any,
      page: Number(page),
      limit: Number(limit),
    });

    res.json(result);
  })
);

/**
 * GET /api/search/suggestions
 * Get search suggestions based on query
 * Query params:
 * - query: search string
 * - limit: number of suggestions to return
 */
router.get(
  "/suggestions",
  asyncHandler(async (req: Request, res: Response) => {
    const { query, limit = "5" } = req.query;

    const result = await getSearchSuggestions(
      query as string,
      Number(limit)
    );

    res.json(result);
  })
);

/**
 * GET /api/search/categories
 * Get available categories with counts
 */
router.get(
  "/categories",
  asyncHandler(async (req: Request, res: Response) => {
    const categories = await getCategoriesWithCounts();
    res.json(categories);
  })
);

/**
 * GET /api/search/featured
 * Get featured/top prompts
 * Query params:
 * - limit: number of prompts to return
 */
router.get(
  "/featured",
  asyncHandler(async (req: Request, res: Response) => {
    const { limit = "6" } = req.query;

    const prompts = await getFeaturedPrompts(Number(limit));
    res.json(prompts);
  })
);

export default router;
