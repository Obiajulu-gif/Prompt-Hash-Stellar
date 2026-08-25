/**
 * Review List Endpoint
 * 
 * Returns all reviews for a specific prompt, sorted by most recent first.
 */

interface StoredReview {
  id: string;
  promptId: string;
  userAddress: string;
  rating: number;
  text: string;
  createdAt: number;
  verified: boolean;
}

// Storage for reviews
const reviewStorage = new Map<string, StoredReview[]>();

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { promptId } = req.query;

  if (!promptId) {
    res.status(400).json({ error: "promptId query parameter is required" });
    return;
  }

  try {
    // Get reviews for this prompt
    const reviews = reviewStorage.get(String(promptId)) || [];
    
    // Sort by most recent first
    const sortedReviews = [...reviews].sort((a, b) => b.createdAt - a.createdAt);

    // Calculate average rating
    const averageRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    res.status(200).json({
      reviews: sortedReviews,
      stats: {
        total: reviews.length,
        averageRating: Math.round(averageRating * 10) / 10,
        distribution: {
          5: reviews.filter(r => r.rating === 5).length,
          4: reviews.filter(r => r.rating === 4).length,
          3: reviews.filter(r => r.rating === 3).length,
          2: reviews.filter(r => r.rating === 2).length,
          1: reviews.filter(r => r.rating === 1).length,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch reviews";
    console.error("Review fetch error:", message);
    res.status(500).json({ error: message });
  }
}
