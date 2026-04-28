import { Request, Response } from "express";
import connectDb from "../db/connectDb";
import { MarketplaceIndex } from "../models/MarketplaceIndex";
import Prompt from "../models/Prompt";
import User from "../models/User";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

/**
 * GET /api/marketplace/search
 *
 * Query params:
 *   q          — full-text search across title + tags
 *   category   — exact match (Marketing | Creative Writing | Programming | Music | Gaming | Other)
 *   minPrice   — minimum price (inclusive)
 *   maxPrice   — maximum price (inclusive)
 *   owner      — filter by ownerWallet address
 *   sort       — newest | oldest | price_asc | price_desc | rating | popular  (default: newest)
 *   page       — 1-based page number (default: 1)
 *   limit      — results per page, max 100 (default: 20)
 *   activeOnly — "false" to include inactive listings (default: true)
 */
export const SearchMarketplace = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();

    const {
      q,
      category,
      minPrice,
      maxPrice,
      owner,
      sort = "newest",
      page = "1",
      limit = String(PAGE_SIZE_DEFAULT),
      activeOnly = "true",
    } = req.query as Record<string, string>;

    // --- Build filter ---
    const filter: Record<string, unknown> = {};

    if (activeOnly !== "false") {
      filter.isActive = true;
    }

    if (q) {
      // MongoDB text search — requires the compound text index on title + tags
      filter.$text = { $search: q };
    }

    if (category) {
      filter.category = category;
    }

    if (owner) {
      filter.ownerWallet = owner.toLowerCase();
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceFilter: Record<string, number> = {};
      if (minPrice !== undefined) {
        const min = parseFloat(minPrice);
        if (isNaN(min)) {
          return res.status(400).json({ error: "minPrice must be a number." });
        }
        priceFilter.$gte = min;
      }
      if (maxPrice !== undefined) {
        const max = parseFloat(maxPrice);
        if (isNaN(max)) {
          return res.status(400).json({ error: "maxPrice must be a number." });
        }
        priceFilter.$lte = max;
      }
      filter.price = priceFilter;
    }

    // --- Build sort ---
    type SortObj = Record<string, 1 | -1>;
    const SORT_MAP: Record<string, SortObj> = {
      newest:     { createdAt: -1 },
      oldest:     { createdAt: 1 },
      price_asc:  { price: 1 },
      price_desc: { price: -1 },
      rating:     { rating: -1, createdAt: -1 },
      popular:    { salesCount: -1, createdAt: -1 },
    };

    // When using $text, MongoDB surfaces a relevance score we can sort by
    const sortObj: SortObj =
      q && sort === "newest"
        ? { score: { $meta: "textScore" } as unknown as -1, createdAt: -1 }
        : (SORT_MAP[sort] ?? SORT_MAP["newest"]);

    // --- Pagination ---
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(limit, 10) || PAGE_SIZE_DEFAULT));
    const skip = (pageNum - 1) * limitNum;

    // --- Query ---
    const [results, total] = await Promise.all([
      MarketplaceIndex.find(filter, q ? { score: { $meta: "textScore" } } : {})
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      MarketplaceIndex.countDocuments(filter),
    ]);

    return res.json({
      data: results,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("Marketplace search error:", err);
    return res.status(500).json({ error: (err as Error).message || "Search failed." });
  }
};

/**
 * POST /api/marketplace/index
 *
 * Called internally (or by the platform API) when a prompt is created
 * through the web UI rather than discovered via the Soroban indexer.
 * This keeps the MarketplaceIndex in sync without waiting for a contract event.
 *
 * Body: { promptId }
 */
export const IndexPrompt = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();

    const { promptId } = req.body;
    if (!promptId) {
      return res.status(400).json({ error: "promptId is required." });
    }

    const prompt = await Prompt.findById(promptId).populate<{
      owner: { walletAddress: string; username: string };
    }>("owner", "walletAddress username");

    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found." });
    }

    const owner = prompt.owner as { walletAddress: string; username: string };

    await MarketplaceIndex.findOneAndUpdate(
      { promptId: prompt._id },
      {
        $set: {
          promptId: prompt._id,
          title: prompt.title,
          category: prompt.category,
          price: prompt.price,
          ownerWallet: owner.walletAddress,
          ownerUsername: owner.username ?? "",
          rating: prompt.rating,
          isActive: true,
          image: prompt.image,
        },
        $setOnInsert: { salesCount: 0 },
      },
      { upsert: true, new: true },
    );

    return res.status(200).json({ message: "Prompt indexed successfully." });
  } catch (err) {
    console.error("Index prompt error:", err);
    return res.status(500).json({ error: (err as Error).message || "Indexing failed." });
  }
};