import { withObservability } from "../../src/lib/observability/wrapper";
import connectDb from "../../server/src/db/connectDb";
import { notifyPromptPurchased } from "../../server/src/services/emailNotifications";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";

/**
 * POST /api/notifications/purchase
 *
 * Send an email receipt to the buyer (or notify the creator) when a purchase
 * is successfully verified. This is the serverless route handler called by
 * the frontend after on-chain purchase confirmation.
 *
 * Body:
 *   creatorWallet  – wallet address of the prompt creator
 *   buyerWallet    – wallet address of the buyer
 *   promptTitle    – title of the purchased prompt
 *   promptId       – ID of the purchased prompt
 *   txHash         – (optional) Stellar transaction hash
 */
async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json(apiError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."));
    return;
  }

  const { creatorWallet, buyerWallet, promptTitle, promptId, txHash } = req.body ?? {};

  // ── Strict validation ───────────────────────────────────────────────
  if (!creatorWallet || !buyerWallet || !promptTitle || !promptId) {
    res.status(400).json(
      apiError(
        ErrorCode.MISSING_FIELDS,
        "creatorWallet, buyerWallet, promptTitle, and promptId are required.",
      ),
    );
    return;
  }

  if (typeof creatorWallet !== "string" || typeof buyerWallet !== "string") {
    res.status(400).json(apiError(ErrorCode.INVALID_PARAMS, "wallet addresses must be strings."));
    return;
  }

  if (creatorWallet.length < 10 || buyerWallet.length < 10) {
    res.status(400).json(apiError(ErrorCode.INVALID_PARAMS, "wallet addresses appear invalid."));
    return;
  }

  // ── Dispatch email ──────────────────────────────────────────────────
  try {
    await connectDb();

    await notifyPromptPurchased(creatorWallet, {
      buyerWallet,
      promptTitle,
      promptId: String(promptId),
      txHash: txHash ?? undefined,
    });

    res.status(200).json({ message: "Purchase notification sent." });
  } catch (err) {
    req.logger?.error({ err }, "Failed to send purchase notification");
    res.status(500).json(apiError(ErrorCode.INTERNAL_ERROR, "Failed to send notification."));
  }
}

export default withObservability(handler, "notifications/purchase");
