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

    const query: Record<string, unknown> = {
      listingStatus: "published",
      isActive: true,
    };

    if (category) {
      query.category = String(category);
    }

    if (walletAddress) {
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
      .populate("owner", "username walletAddress")
      .sort({ createdAt: -1 });

    res.status(200).json(prompts);
  } catch (error) {
    console.error("Fetch prompts error:", error);
    res.status(500).json({ error: "Failed to fetch prompts" });
  }
}

export default withObservability(handler, "prompts/index");
