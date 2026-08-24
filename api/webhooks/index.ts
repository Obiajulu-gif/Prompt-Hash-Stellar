import { withObservability } from "../../src/lib/observability/wrapper";
import connectDb from "../../server/src/db/connectDb";
import WebhookSubscription from "../../server/src/models/WebhookSubscription";
import { randomBytes } from "crypto";
import {
  buildChallengeMessage,
  verifyChallengeSignature,
  verifyChallengeToken,
  globalNonceLedger,
} from "../../src/lib/auth/challenge";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";

/**
 * Sentinel promptId used when issuing a challenge token for webhook
 * registration/ownership proofs. The challenge flow is otherwise identical to
 * the unlock flow (server issues a token, the wallet signs the challenge
 * message, the server verifies the signature). Reusing the same primitive
 * keeps a single source of truth for wallet-ownership verification.
 */
const WEBHOOK_CHALLENGE_PROMPT_ID = "webhook-registration";

export async function webhookHandler(req: any, res: any) {
  await connectDb();

  if (req.method === "GET") {
    const { walletAddress, token, signedMessage } = req.query ?? {};
    if (!walletAddress) {
      res.status(400).json({ error: "walletAddress query param is required." });
      return;
    }

    // Exclude the signing secret from the query so it never enters the
    // response object (defense-in-depth; see POST which still stores it for
    // delivery signature verification).
    const sub = await WebhookSubscription.findOne({
      walletAddress: String(walletAddress).toLowerCase(),
    }).select("-secret");
    if (!sub) {
      res.status(404).json({ error: "No webhook registered for this wallet." });
      return;
    }

    const owned = await verifyWebhookOwnership(
      String(walletAddress),
      token ? String(token) : undefined,
      signedMessage ? String(signedMessage) : undefined,
    );

    // The delivery URL is sensitive: it reveals where a creator's sale
    // notifications are routed. Only return it to a caller that has proven
    // ownership of the wallet the subscription belongs to.
    const response = sub.toObject();
    if (!owned) {
      delete response.url;
    }

    res.status(200).json(response);
    return;
  }

  if (req.method === "POST") {
    const { walletAddress, url, events, token, signedMessage } = req.body ?? {};
    if (!walletAddress || !url) {
      res.status(400).json({ error: "walletAddress and url are required." });
      return;
    }

    // Require a signed proof of wallet ownership before creating or updating
    // any subscription. Without this, anyone who knows (or guesses) a creator
    // address could hijack their notification delivery or DoS it.
    if (!token || !signedMessage) {
      res
        .status(400)
        .json(
          apiError(
            ErrorCode.MISSING_FIELDS,
            "token and signedMessage (wallet-signed challenge) are required to register a webhook.",
          ),
        );
      return;
    }

    const owned = await verifyWebhookOwnership(
      String(walletAddress),
      String(token),
      String(signedMessage),
    );
    if (!owned) {
      res
        .status(401)
        .json(
          apiError(
            ErrorCode.INVALID_SIGNATURE,
            "Webhook registration requires a valid wallet-signed proof of ownership for walletAddress.",
          ),
        );
      return;
    }

    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: "url must be a valid URL." });
      return;
    }

    const secret = randomBytes(32).toString("hex");
    const allowedEvents = ["PromptPurchased"];
    const resolvedEvents = Array.isArray(events)
      ? events.filter((e: string) => allowedEvents.includes(e))
      : ["PromptPurchased"];

    const existing = await WebhookSubscription.findOne({
      walletAddress: String(walletAddress).toLowerCase(),
    });

    if (existing) {
      existing.url = url;
      existing.events = resolvedEvents;
      existing.active = true;
      existing.failureCount = 0;
      await existing.save();
      res.status(200).json({ message: "Webhook updated.", id: existing._id, secret });
      return;
    }

    const sub = new WebhookSubscription({
      walletAddress: String(walletAddress).toLowerCase(),
      url,
      secret,
      events: resolvedEvents,
    });
    await sub.save();
    res.status(201).json({ message: "Webhook registered.", id: sub._id, secret });
    return;
  }

  if (req.method === "DELETE") {
    const { walletAddress, token, signedMessage } = req.body ?? {};
    if (!walletAddress) {
      res.status(400).json({ error: "walletAddress is required." });
      return;
    }

    // Removing a subscription is a state-changing action on a creator's
    // account, so it also requires proof of ownership.
    if (!token || !signedMessage) {
      res
        .status(400)
        .json(
          apiError(
            ErrorCode.MISSING_FIELDS,
            "token and signedMessage (wallet-signed challenge) are required to remove a webhook.",
          ),
        );
      return;
    }

    const owned = await verifyWebhookOwnership(
      String(walletAddress),
      String(token),
      String(signedMessage),
    );
    if (!owned) {
      res
        .status(401)
        .json(
          apiError(
            ErrorCode.INVALID_SIGNATURE,
            "Webhook removal requires a valid wallet-signed proof of ownership for walletAddress.",
          ),
        );
      return;
    }

    await WebhookSubscription.deleteOne({ walletAddress: String(walletAddress).toLowerCase() });
    res.status(200).json({ message: "Webhook removed." });
    return;
  }

  res.status(405).json({ error: "Method not allowed." });
}

/**
 * Verify that `signedMessage` is a valid wallet signature over a server-issued
 * challenge token bound to `walletAddress` and the webhook sentinel promptId.
 *
 * Returns `false` (rather than throwing) so callers can translate the failure
 * into an appropriate HTTP response. Replay protection is enforced by
 * consuming the token's nonce via the shared nonce ledger (fail-closed: a
 * reused nonce is rejected).
 */
async function verifyWebhookOwnership(
  walletAddress: string,
  token: string | undefined,
  signedMessage: string | undefined,
): Promise<boolean> {
  const secret = process.env.CHALLENGE_TOKEN_SECRET;
  if (!secret || !token || !signedMessage) {
    return false;
  }

  try {
    const payload = verifyChallengeToken(
      secret,
      String(token),
      String(walletAddress),
      WEBHOOK_CHALLENGE_PROMPT_ID,
    );

    const challengeMessage = buildChallengeMessage(payload);
    if (
      !verifyChallengeSignature(
        String(walletAddress),
        challengeMessage,
        String(signedMessage),
      )
    ) {
      return false;
    }

    const consumed = await globalNonceLedger.consume(
      payload.nonce,
      payload.expiresAt,
    );
    if (!consumed) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export default withObservability(webhookHandler, "webhooks");
