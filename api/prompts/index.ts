import { withObservability } from "../../src/lib/observability/wrapper";
import connectDb from "../../server/src/db/connectDb";
import Prompt from "../../server/src/models/Prompt";
import User from "../../server/src/models/User";

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

    const { category, walletAddress, onChainId } = req.query ?? {};

    if (onChainId) {
      const prompt = await Prompt.findOne(
        buildMarketplaceQuery({ onChainId: String(onChainId) }),
      )
        .populate("owner", "username walletAddress")
        .lean();

      res.status(200).json(prompt ? [prompt] : []);
      return;
    }

    const query = buildMarketplaceQuery({
      category: category ? String(category) : undefined,
      walletAddress: walletAddress ? String(walletAddress) : undefined,
    });

    const prompts = await Prompt.find(query)
      .populate("owner", "username walletAddress")
      .sort({ createdAt: -1 });

    res.status(200).json(prompts);
  } catch (error) {
    console.error("Fetch prompts error:", error);
    res.status(500).json({ error: "Failed to fetch prompts" });
  }
}

export default withObservability(handler, "prompts/index");
