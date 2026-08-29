import { withObservability } from "../../src/lib/observability/wrapper";
import connectDb from "../../server/src/db/connectDb";
import Prompt from "../../server/src/models/Prompt";
import User from "../../server/src/models/User";
import Purchase from "../../server/src/models/Purchase";
import {
  getRecommendedPrompts,
  PromptListing,
} from "../../src/lib/recommendations/recommendationEngine";

async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    await connectDb();

    const {
      category,
      walletAddress,
      recommendations,
      viewerWallet,
      limit,
    } = req.query ?? {};

    const query: Record<string, unknown> = {
      listingStatus: "published",
      isActive: true,
      similarityFlag: { $ne: "highly_similar" },
      integrityStatus: { $nin: ["corrupted", "missing"] },
    };

    if (category) {
      query.category = String(category);
    }

    if (walletAddress && !recommendations) {
      const user = await User.findOne({
        walletAddress: String(walletAddress).toLowerCase(),
      });
      if (!user) {
        res.status(200).json([]);
        return;
      }
      query.owner = user._id;
    }

    const prompts = await Prompt.find(query)
      .populate("owner", "username walletAddress rating")
      .sort({ createdAt: -1 });

    if (recommendations === "true" || recommendations === true) {
      const activeWallet = String(viewerWallet || walletAddress || "").toLowerCase();
      let purchasedPromptIds: string[] = [];

      if (activeWallet) {
        const purchases = await Purchase.find({
          buyerWallet: activeWallet,
          status: "purchased",
        }).select("promptId");
        purchasedPromptIds = purchases.map((p) => String(p.promptId));
      }

      const listings: PromptListing[] = prompts.map((p: any) => ({
        id: String(p._id),
        title: p.title,
        category: p.category,
        price: p.price,
        rating: p.rating,
        salesCount: p.salesCount,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        ownerId: String(p.owner?._id || ""),
        ownerWallet: p.owner?.walletAddress,
        creatorRating: p.owner?.rating,
        creatorTrustScore: p.owner?.rating,
        listingStatus: p.listingStatus,
        isActive: p.isActive,
        similarityFlag: p.similarityFlag,
        integrityStatus: p.integrityStatus,
      }));

      const recommended = getRecommendedPrompts(listings, {
        userWallet: activeWallet,
        purchasedPromptIds,
        categoryDiversity: true,
        limit: limit ? parseInt(String(limit), 10) : 12,
      });

      res.status(200).json(recommended);
      return;
    }

    res.status(200).json(prompts);
  } catch (error) {
    console.error("Fetch prompts error:", error);
    res.status(500).json({ error: "Failed to fetch prompts" });
  }
}

export default withObservability(handler, "prompts/index");
