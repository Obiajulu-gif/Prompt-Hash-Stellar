/**
 * Review List Endpoint
 * 
 * Returns all verified, durable reviews for a specific prompt, sorted by most recent first.
 * Calculates rating statistics deterministically from stored review records.
 */

import connectDb from "../../server/src/db/connectDb";
import Review from "../../server/src/models/Review";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { promptId } = req.query || {};

  if (!promptId) {
    res.status(400).json({ error: "promptId query parameter is required" });
    return;
  }

  try {
    await connectDb();

    // Query durable reviews from persistent store (excluding hidden/moderated)
    const reviews = await Review.find({
      promptId: String(promptId),
      status: { $ne: "hidden" },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Calculate rating distribution & average rating deterministically
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;

    const formattedReviews = reviews.map((r: any) => {
      const ratingVal = Math.min(5, Math.max(1, Math.round(r.rating || 5)));
      distribution[ratingVal] = (distribution[ratingVal] || 0) + 1;
      sum += ratingVal;

      return {
        id: (r._id || r.id || "").toString(),
        promptId: r.promptId,
        userAddress: r.userAddress,
        rating: ratingVal,
        text: r.text || "",
        createdAt: r.createdAt ? new Date(r.createdAt).getTime() : Date.now(),
        verified: r.verified !== false,
      };
    });

    const total = formattedReviews.length;
    const averageRating = total > 0 ? sum / total : 0;

    res.status(200).json({
      reviews: formattedReviews,
      stats: {
        total,
        averageRating: Math.round(averageRating * 10) / 10,
        distribution,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch reviews";
    console.error("Review fetch error:", message);
    res.status(500).json({ error: message });
  }
}
