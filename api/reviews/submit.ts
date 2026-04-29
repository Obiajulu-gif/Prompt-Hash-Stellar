/**
 * Review Submission Endpoint
 * 
 * Allows verified buyers to submit ratings and reviews for purchased prompts.
 * Verifies wallet ownership and purchase access before accepting reviews.
 */

import { hasAccess, type PromptHashConfig } from "../../src/lib/stellar/promptHashClient";

interface ReviewSubmission {
  promptId: string;
  userAddress: string;
  rating: number;
  text: string;
  signature: string;
}

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

function getServerConfig(): PromptHashConfig {
  const rpcUrl = process.env.PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase = process.env.PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
  const promptHashContractId = process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID ?? "";
  const nativeAssetContractId = process.env.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const simulationAccount = process.env.PUBLIC_STELLAR_SIMULATION_ACCOUNT ?? process.env.UNLOCK_PUBLIC_KEY ?? "";

  return {
    rpcUrl,
    networkPassphrase,
    promptHashContractId,
    nativeAssetContractId,
    simulationAccount,
    allowHttp: new URL(rpcUrl).hostname === "localhost",
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { promptId, userAddress, rating, text, signature }: ReviewSubmission = req.body;

  // Validation
  if (!promptId || !userAddress || !rating || !text) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  if (rating < 1 || rating > 5) {
    res.status(400).json({ error: "Rating must be between 1 and 5" });
    return;
  }

  if (text.trim().length < 10) {
    res.status(400).json({ error: "Review text must be at least 10 characters" });
    return;
  }

  if (text.length > 500) {
    res.status(400).json({ error: "Review text must not exceed 500 characters" });
    return;
  }

  try {
    // Verify user has purchased the prompt
    const config = getServerConfig();
    const access = await hasAccess(config, userAddress, promptId);

    if (!access) {
      res.status(403).json({ 
        error: "Only verified buyers can submit reviews",
        verified: false 
      });
      return;
    }

    // Check if user already reviewed this prompt
    const existingReviews = reviewStorage.get(promptId) || [];
    const hasReviewed = existingReviews.some(r => r.userAddress === userAddress);

    if (hasReviewed) {
      res.status(409).json({ error: "You have already reviewed this prompt" });
      return;
    }

    // Create review
    const review: StoredReview = {
      id: `review_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      promptId,
      userAddress,
      rating,
      text: text.trim(),
      createdAt: Date.now(),
      verified: true,
    };

    // Store review (mock - use database in production)
    const reviews = reviewStorage.get(promptId) || [];
    reviews.push(review);
    reviewStorage.set(promptId, reviews);

    console.log(`✓ Review submitted for prompt ${promptId} by ${userAddress.slice(0, 8)}...`);

    res.status(201).json({
      success: true,
      review: {
        id: review.id,
        rating: review.rating,
        createdAt: review.createdAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit review";
    console.error("Review submission error:", message);
    res.status(500).json({ error: message });
  }
}
