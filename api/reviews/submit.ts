/**
 * Review Submission Endpoint
 * 
 * Allows verified buyers to submit wallet-signed ratings and reviews for purchased prompts.
 * Verifies domain-separated signature and finalized purchase access before persisting reviews.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import connectDb from "../../server/src/db/connectDb";
import Review from "../../server/src/models/Review";
import Purchase from "../../server/src/models/Purchase";
import { hasAccess, type PromptHashConfig } from "../../src/lib/stellar/promptHashClient";
import { cacheDel, CACHE_KEYS } from "../../server/src/services/cacheService";

export interface ReviewSubmission {
  promptId: string;
  userAddress: string;
  rating: number;
  text: string;
  signature: string;
}

export function buildReviewMessage(userAddress: string, promptId: string, rating: number, text: string): string {
  return `prompt-hash review:${userAddress}:${promptId}:${rating}:${text.trim()}`;
}

export function verifyReviewSignature(
  userAddress: string,
  promptId: string,
  rating: number,
  text: string,
  signature: string,
): boolean {
  try {
    const message = buildReviewMessage(userAddress, promptId, rating, text);
    const keypair = Keypair.fromPublicKey(userAddress);
    
    // Accept base64 or hex signature
    let sigBuffer: Buffer;
    if (/^[0-9a-fA-F]+$/.test(signature)) {
      sigBuffer = Buffer.from(signature, "hex");
    } else {
      sigBuffer = Buffer.from(signature, "base64");
    }

    return keypair.verify(Buffer.from(message, "utf8"), sigBuffer);
  } catch (err) {
    return false;
  }
}

function getServerConfig(): PromptHashConfig {
  const rpcUrl = process.env.PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase = process.env.PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
  const promptHashContractId = process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID ?? "";
  const nativeAssetContractId = process.env.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID ?? "";
  const simulationAccount = process.env.PUBLIC_STELLAR_SIMULATION_ACCOUNT ?? "";

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

  const { promptId, userAddress, rating, text, signature }: ReviewSubmission = req.body || {};

  // Input Validation
  if (!promptId || !userAddress || !rating || text === undefined) {
    res.status(400).json({ error: "promptId, userAddress, rating, and text are required" });
    return;
  }

  if (!signature) {
    res.status(401).json({ error: "Wallet signature is required to submit a review" });
    return;
  }

  if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    res.status(400).json({ error: "Rating must be an integer between 1 and 5" });
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

  // Signature verification
  const isValidSig = verifyReviewSignature(userAddress, promptId, rating, text, signature);
  if (!isValidSig) {
    res.status(401).json({ error: "Invalid domain-separated wallet signature for review" });
    return;
  }

  try {
    // Connect DB if available
    await connectDb();

    // Verify finalized access / purchase evidence
    let hasPurchased = false;
    try {
      const dbPurchase = await Purchase.findOne({
        promptId,
        buyerWallet: userAddress.toLowerCase(),
        status: { $ne: "refunded" },
      });
      if (dbPurchase) {
        hasPurchased = true;
      }
    } catch {
      // Fallback to contract check if DB query not connected
    }

    if (!hasPurchased) {
      const config = getServerConfig();
      const onChainAccess = await hasAccess(config, userAddress, promptId);
      if (!onChainAccess) {
        res.status(403).json({
          error: "Only verified buyers with finalized entitlement can submit reviews",
          verified: false,
        });
        return;
      }
    }

    // Check for existing review (support update or single review constraint)
    const existing = await Review.findOne({
      promptId,
      userAddress: userAddress.toLowerCase(),
    });

    let reviewRecord;
    if (existing) {
      existing.rating = rating;
      existing.text = text.trim();
      existing.signature = signature;
      existing.verified = true;
      existing.updatedAt = new Date();
      reviewRecord = await existing.save();
    } else {
      reviewRecord = await Review.create({
        promptId,
        userAddress: userAddress.toLowerCase(),
        rating,
        text: text.trim(),
        signature,
        verified: true,
      });
    }

    // Invalidate cached detail
    await cacheDel(CACHE_KEYS.promptDetail(promptId));

    res.status(201).json({
      success: true,
      review: {
        id: reviewRecord._id || reviewRecord.id,
        promptId: reviewRecord.promptId,
        userAddress: reviewRecord.userAddress,
        rating: reviewRecord.rating,
        text: reviewRecord.text,
        createdAt: reviewRecord.createdAt,
        verified: reviewRecord.verified,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit review";
    console.error("Review submission error:", message);
    res.status(500).json({ error: message });
  }
}
