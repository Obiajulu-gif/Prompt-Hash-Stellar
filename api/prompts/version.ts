import { withObservability } from "../../src/lib/observability/wrapper";
import connectDb from "../../server/src/db/connectDb";
import Prompt from "../../server/src/models/Prompt";
import PromptVersion from "../../server/src/models/PromptVersion";
import Purchase from "../../server/src/models/Purchase";
import User from "../../server/src/models/User";

async function handler(req: any, res: any) {
  await connectDb();

  // GET /api/prompts/version?promptId=&buyerWallet=
  // Returns the versioned content a buyer is entitled to.
  if (req.method === "GET") {
    const { promptId, buyerWallet } = req.query ?? {};

    if (!promptId || !buyerWallet) {
      res.status(400).json({ error: "promptId and buyerWallet are required." });
      return;
    }

    const purchase = await Purchase.findOne({
      promptId: String(promptId),
      buyerWallet: String(buyerWallet).toLowerCase(),
    });

    // If no purchase record, fall back to v1 (legacy purchase before versioning).
    const versionIndex = purchase?.versionIndex ?? 1;

    const version = await PromptVersion.findOne({
      promptId: String(promptId),
      versionIndex,
    });

    const prompt = await Prompt.findById(promptId).lean();

    res.status(200).json({
      versionIndex,
      content: version?.content ?? (prompt as any)?.content ?? null,
      changeNote: version?.changeNote ?? "",
      purchasedAt: purchase?.createdAt ?? null,
    });
    return;
  }

  // POST /api/prompts/version — creator posts a new version.
  if (req.method === "POST") {
    const { promptId, walletAddress, content, changeNote } = req.body ?? {};

    if (!promptId || !walletAddress || !content) {
      res.status(400).json({ error: "promptId, walletAddress, and content are required." });
      return;
    }

    const user = await User.findOne({ walletAddress: String(walletAddress).toLowerCase() });
    if (!user) { res.status(404).json({ error: "User not found." }); return; }

    const prompt = await Prompt.findOne({ _id: promptId, owner: user._id });
    if (!prompt) { res.status(403).json({ error: "Prompt not found or not owned by this wallet." }); return; }

    const nextVersion = (prompt.currentVersionIndex ?? 1) + 1;

    await PromptVersion.create({
      promptId: String(prompt._id),
      versionIndex: nextVersion,
      content,
      changeNote: changeNote ?? "",
      createdBy: String(walletAddress).toLowerCase(),
    });

    await Prompt.findByIdAndUpdate(prompt._id, { currentVersionIndex: nextVersion });

    res.status(201).json({ message: "Version posted.", versionIndex: nextVersion });
    return;
  }

  res.status(405).json({ error: "Method not allowed." });
}

export default withObservability(handler, "prompts/version");
