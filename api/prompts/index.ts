import { withObservability } from "../../src/lib/observability/wrapper";
import connectDb from "../../server/src/db/connectDb";
import Prompt from "../../server/src/models/Prompt";
import User from "../../server/src/models/User";
import Purchase from "../../server/src/models/Purchase";
import {
  getRecommendedPrompts,
  PromptListing,
} from "../../src/lib/recommendations/recommendationEngine";

/**
 * Build the MongoDB query for the public/creator marketplace listing.
 *
 * Moderation-aware filtering:
 *  - When a `walletAddress` is supplied (creator dashboard view) we intentionally
 *    DO NOT hide the creator's own restricted/retired prompts so the dashboard can
 *    show current moderation status and reason.
 *  - In the public view (no owner) we hide any prompt whose `moderationStatus`
 *    is `restricted` or `retired` so moderated listings disappear from the
 *    marketplace consistently with the detail and creator pages.
 *
 * Exported for unit testing without pulling in the observability wrapper.
 */
export function buildMarketplaceQuery(params: {
  category?: string | string[];
  walletAddress?: string;
  onChainId?: string;
}): Record<string, unknown> {
  const query: Record<string, unknown> = {
    listingStatus: "published",
    isActive: true,
  };

  if (params.onChainId !== undefined && params.onChainId !== "") {
    const numeric = Number(params.onChainId);
    query.onChainId = Number.isFinite(numeric) ? numeric : params.onChainId;
    // A single-prompt lookup is moderation-aware regardless of viewer; we return
    // the document as stored so the caller can decide visibility.
    delete query.listingStatus;
    delete query.isActive;
    return query;
  }

  if (params.walletAddress) {
    // Creator dashboard: surface every owned prompt, including moderated ones.
    query.owner = params.walletAddress;
    delete query.listingStatus;
    delete query.isActive;
  } else {
    // Public marketplace: hide moderated listings.
    query.moderationStatus = { $in: [null, "none"] };
  }

  if (params.category) {
    query.category = String(params.category);
  }

  return query;
}

async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    await connectDb();

    const { category, walletAddress } = req.query ?? {};
    const limitParam = req.query?.limit ?? req.query?.pageSize;
    const limit = Math.min(parseInt(limitParam as string) || 20, 50);
    const cursor = req.query?.cursor as string | undefined;
    const { category, walletAddress, onChainId } = req.query ?? {};

    if (onChainId) {
      const prompt = await Prompt.findOne(
        buildMarketplaceQuery({ onChainId: String(onChainId) }),
      )
        .populate("owner", "username walletAddress")
        .lean();
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

      res.status(200).json(prompt ? [prompt] : []);
      return;
    }

    const query = buildMarketplaceQuery({
      category: category ? String(category) : undefined,
      walletAddress: walletAddress ? String(walletAddress) : undefined,
    });
    if (walletAddress && !recommendations) {
      const user = await User.findOne({
        walletAddress: String(walletAddress).toLowerCase(),
      });
      if (!user) {
        res
          .status(200)
          .json({
            data: [],
            metadata: { hasNextPage: false, nextCursor: null },
          });
        return;
      }
      query.owner = user._id;
    }

    if (cursor) {
      query._id = { $lt: cursor };
    }

    const prompts = await Prompt.find(query)
      .populate("owner", "username walletAddress")
      .sort({ _id: -1 })
      .limit(limit + 1);

    let hasNextPage = false;
    let nextCursor: unknown = null;

    if (prompts.length > limit) {
      hasNextPage = true;
      prompts.pop();
      nextCursor = prompts[prompts.length - 1]._id;
    }

    res.status(200).json({
      data: prompts,
      metadata: { hasNextPage, nextCursor },
    });
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
