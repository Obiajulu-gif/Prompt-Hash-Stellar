/**
 * Review Client
 * 
 * Client-side API for submitting and fetching prompt reviews.
 */

export interface Review {
  id: string;
  promptId: string;
  userAddress: string;
  rating: number;
  text: string;
  createdAt: number;
  verified: boolean;
}

export interface ReviewStats {
  total: number;
  averageRating: number;
  distribution: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
}

export interface ReviewListResponse {
  reviews: Review[];
  stats: ReviewStats;
}

const API_BASE = "/api/reviews";

export class ReviewClient {
  /**
   * Submit a new review for a prompt
   */
  static async submitReview(
    promptId: string,
    userAddress: string,
    rating: number,
    text: string,
    signature: string = ""
  ): Promise<{ success: boolean; review: { id: string; rating: number; createdAt: number } }> {
    const response = await fetch(`${API_BASE}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptId,
        userAddress,
        rating,
        text,
        signature,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to submit review");
    }

    return response.json();
  }

  /**
   * Get all reviews for a prompt
   */
  static async getReviews(promptId: string): Promise<ReviewListResponse> {
    const response = await fetch(`${API_BASE}/list?promptId=${promptId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to fetch reviews");
    }

    return response.json();
  }

  /**
   * Get review statistics for a prompt
   */
  static async getReviewStats(promptId: string): Promise<ReviewStats> {
    const data = await this.getReviews(promptId);
    return data.stats;
  }
}
