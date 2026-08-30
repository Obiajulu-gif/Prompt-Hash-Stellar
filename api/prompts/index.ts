import { withObservability } from "../../src/lib/observability/wrapper";
import connectDb from "../../server/src/db/connectDb";
import Prompt from "../../server/src/models/Prompt";
import User from "../../server/src/models/User";

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

    const query: Record<string, unknown> = {
      listingStatus: "published",
      isActive: true,
      // Hide restricted prompts from public marketplace queries
      moderationStatus: { $ne: "restricted" },
    };

    if (category) {
      query.category = String(category);
    }

    if (walletAddress) {
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
  } catch (error) {
    console.error("Fetch prompts error:", error);
    res.status(500).json({ error: "Failed to fetch prompts" });
  }
}

export default withObservability(handler, "prompts/index");
