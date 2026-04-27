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

// Mock storage - in production, use database
const reviewStorage = new Map<string, StoredReview[]>();

// Seed some mock data for testing
const seedMockReviews = () => {
  const mockReviews: StoredReview[] = [
    {
      id: "review_1",
      promptId: "1",
      userAddress: "GABC123XYZ456DEF789GHI012JKL345MNO678PQR901STU234VWX567YZ",
      rating: 5,
      text: "Excellent prompt! Helped me generate high-quality technical documentation in minutes. The structure and clarity are outstanding.",
      createdAt: Date.now() - 86400000 * 2, // 2 days ago
      verified: true,
    },
    {
      id: "review_2",
      promptId: "1",
      userAddress: "GBCD234ABC567EFG890HIJ123KLM456NOP789QRS012TUV345WXY678ZA",
      rating: 4,
      text: "Very useful for system design work. Could use a bit more detail on edge cases, but overall a solid prompt.",
      createdAt: Date.now() - 86400000 * 5, // 5 days ago
      verified: true,
    },
    {
      id: "review_3",
      promptId: "2",
      userAddress: "GCDE345BCD678FGH901IJK234LMN567OPQ890RST123UVW456XYZ789AB",
      rating: 5,
      text: "Amazing for creative writing! The narrative structures it generates are incredibly detailed and engaging. Worth every XLM.",
      createdAt: Date.now() - 86400000 * 1, // 1 day ago
      verified: true,
    },
  ];

  mockReviews.forEach(review => {
    const existing = reviewStorage.get(review.promptId) || [];
    existing.push(review);
    reviewStorage.set(review.promptId, existing);
  });
};

// Seed on first load
if (reviewStorage.size === 0) {
  seedMockReviews();
}

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
