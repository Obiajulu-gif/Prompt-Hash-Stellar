import express, { Request, Response } from "express";
import connectDb from "../db/connectDb";
import Review from "../models/Review";
import Purchase from "../models/Purchase";
import { cacheDel } from "../services/cacheService";
import { CACHE_KEYS } from "../services/cacheService";

export const reviewRouter = express.Router();

// POST /api/reviews/submit
reviewRouter.post("/submit", async (req: Request, res: Response) => {
  try {
    await connectDb();

    const { promptId, userAddress, rating, text } = req.body as {
      promptId?: string;
      userAddress?: string;
      rating?: number;
      text?: string;
    };

    if (!promptId || !userAddress || !rating) {
      return res.status(400).json({ error: "promptId, userAddress and rating are required" });
    }

    if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      return res.status(400).json({ error: "rating must be an integer between 1 and 5" });
    }

    // Verify ownership — buyer must have a purchase record for this prompt
    const purchase = await Purchase.findOne({
      promptId,
      buyerWallet: userAddress.toLowerCase(),
    });

    if (!purchase) {
      return res.status(403).json({
        error: "You must own this prompt before leaving a review",
      });
    }

    const review = await Review.findOneAndUpdate(
      { promptId, userAddress: userAddress.toLowerCase() },
      { rating, text: text ?? "", verified: true },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Invalidate cached detail for this prompt so ratings refresh
    await cacheDel(CACHE_KEYS.promptDetail(promptId));

    return res.json({
      success: true,
      review: { id: review._id, rating: review.rating, createdAt: review.createdAt },
    });
  } catch (err) {
    console.error("Review submit error:", err);
    return res.status(500).json({ error: "Failed to submit review" });
  }
});

// GET /api/reviews/list?promptId=X
reviewRouter.get("/list", async (req: Request, res: Response) => {
  try {
    await connectDb();

    const { promptId } = req.query as { promptId?: string };
    if (!promptId) return res.status(400).json({ error: "promptId is required" });

    const reviews = await Review.find({ promptId }).sort({ createdAt: -1 }).lean();

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    for (const r of reviews) {
      distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
      sum += r.rating;
    }

    const stats = {
      total: reviews.length,
      averageRating: reviews.length ? sum / reviews.length : 0,
      distribution,
    };

    return res.json({
      reviews: reviews.map((r) => ({
        id: r._id,
        promptId: r.promptId,
        userAddress: r.userAddress,
        rating: r.rating,
        text: r.text,
        createdAt: new Date(r.createdAt as Date).getTime(),
        verified: r.verified,
      })),
      stats,
    });
  } catch (err) {
    console.error("Review list error:", err);
    return res.status(500).json({ error: "Failed to fetch reviews" });
  }
});
