import { withObservability } from "../../src/lib/observability/wrapper";
import connectDb from "../../server/src/db/connectDb";
import Prompt from "../../server/src/models/Prompt";
import PromptVersion from "../../server/src/models/PromptVersion";
import Purchase from "../../server/src/models/Purchase";
import User from "../../server/src/models/User";
import { getPrompt, type PromptHashConfig } from "../../src/lib/stellar/promptHashClient";
import { computeListingSnapshotHash } from "../../src/lib/auth/challenge";

/** Minimal server-side contract config built from public env vars. */
function buildServerConfig(): PromptHashConfig {
  const rpcUrl = process.env.PUBLIC_STELLAR_RPC_URL ?? "";
  return {
    rpcUrl,
    rpcUrls: process.env.PUBLIC_STELLAR_RPC_URLS?.split(",")
      .map((u) => u.trim())
      .filter(Boolean),
    networkPassphrase:
      process.env.PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    promptHashContractId: process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID ?? "",
    nativeAssetContractId: process.env.PUBLIC_NATIVE_ASSET_CONTRACT_ID ?? "",
    simulationAccount: process.env.PUBLIC_SIMULATION_ACCOUNT ?? "",
    allowHttp: rpcUrl.includes("localhost"),
  };
}

/**
 * Compute the canonical listing snapshot hash for purchase preflight (issue #698).
 * Prefers the authoritative on-chain listing; falls back to DB-derived fields if
 * the chain read is unavailable so the preflight is always deterministic.
 */
async function computePreflightSnapshot(prompt: any): Promise<string | undefined> {
  const contractId = process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID;
  if (contractId && prompt?.onChainId) {
    try {
      const onChain = await getPrompt(buildServerConfig(), BigInt(prompt.onChainId));
      if (onChain) {
        return computeListingSnapshotHash({
          promptId: String(onChain.id),
          owner: String(onChain.creator),
          priceStroops: String(onChain.priceStroops ?? ""),
          asset: String((onChain as any).asset ?? ""),
          version: String((onChain as any).revision ?? ""),
          expiresAt: String((onChain as any).expiresAt ?? "0"),
        });
      }
    } catch {
      // Fall through to DB-derived snapshot below.
    }
  }

  if (!prompt) return undefined;
  const ownerWallet = prompt.owner?.walletAddress ?? "";
  return computeListingSnapshotHash({
    promptId: String(prompt.onChainId ?? prompt._id ?? ""),
    owner: String(ownerWallet),
    priceStroops: String(prompt.priceStroops ?? ""),
    asset: String(prompt.asset ?? ""),
    version: String(prompt.revision ?? ""),
    expiresAt: String(prompt.expiresAt ?? "0"),
  });
}

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

    const prompt = await Prompt.findById(promptId).populate("owner", "walletAddress").lean();

    const listingSnapshotHash = await computePreflightSnapshot(prompt);

    res.status(200).json({
      versionIndex,
      content: version?.content ?? (prompt as any)?.content ?? null,
      changeNote: version?.changeNote ?? "",
      purchasedAt: purchase?.createdAt ?? null,
      listingSnapshotHash,
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
