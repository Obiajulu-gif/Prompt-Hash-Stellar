import { Router } from "express";
import Prompt from "../models/Prompt.js";

const searchRouter = Router();

/**
 * GET /api/marketplace/search
 * Query params: q (text), category, minPrice, maxPrice, sort, page, limit
 */
searchRouter.get("/", async (req, res) => {
  const {
    q,
    category,
    minPrice,
    maxPrice,
    sort = "newest",
    page = "1",
    limit = "20",
  } = req.query;

  const filter: Record<string, unknown> = { isActive: true };

  if (q && typeof q === "string") {
    filter.$text = { $search: q };
  }

  if (category && typeof category === "string") {
    filter.category = category;
  }

  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) (filter.price as Record<string, number>).$gte = Number(minPrice);
    if (maxPrice) (filter.price as Record<string, number>).$lte = Number(maxPrice);
  }

  const sortOption: Record<string, 1 | -1> =
    sort === "price_asc"
      ? { price: 1 }
      : sort === "price_desc"
        ? { price: -1 }
        : sort === "popular"
          ? { salesCount: -1 }
          : { createdAt: -1 };

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [prompts, total] = await Promise.all([
    Prompt.find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .populate("owner", "username walletAddress")
      .lean(),
    Prompt.countDocuments(filter),
  ]);

  res.json({
    prompts,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  });
});

export default searchRouter;
