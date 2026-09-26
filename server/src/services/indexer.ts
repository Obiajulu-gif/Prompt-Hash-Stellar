import { rpc, scValToNative } from "@stellar/stellar-sdk";
import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";
import User from "../models/User";
import Purchase from "../models/Purchase";
import PriceChange from "../models/PriceChange";
import { IndexerState } from "../models/IndexerState";
import ProcessedEvent from "../models/ProcessedEvent";
import QuarantinedEvent from "../models/QuarantinedEvent";
import { scanForSimilarity } from "./similarityDetection";
import { enqueue as enqueueWebhookEvent } from "./webhookOutbox";
import { cacheDel, cacheDelPattern, CACHE_KEYS } from "./cacheService";
import { decodeEvent } from "../../../packages/sdk/src/events/decode.js";
import { logger } from "./structuredLogger";
import { applyDisputeTransition } from "./purchaseDisputes";

const POLL_INTERVAL_MS = 5_000;
const LEASE_TTL_MS = 30_000; // lease expires after 30 s of inactivity
const REPLICA_ID = `${process.pid}@${os.hostname()}`;

let tickInFlight = false; // single-flight guard for the current process

// Entitlement decision cache — invalidated on settlement events (#545, #602).
// Uses Redis for multi-instance deployments; short TTL balances freshness with RPC load.
const ENTITLEMENT_CACHE_TTL_SECS = 30;

async function invalidateEntitlementCacheForPrompt(promptId: string): Promise<void> {
  await cacheDelPattern(CACHE_KEYS.entitlementDecisionPattern(promptId));
}

/**
 * Resolves a wallet address to a User document, creating a minimal wallet
 * subject if none exists yet. The subject carries only the on-chain address;
 * no synthetic username or reputation rating is injected. Identity fields
 * (username, displayName, rating) must be set explicitly through verified
 * profile claims to prevent unearned reputation from landing in the index.
 */
async function ensureUser(walletAddress: string) {
  const normalized = walletAddress.toLowerCase();
  let user = await User.findOne({ walletAddress: normalized });
  if (!user) {
    user = await User.create({ walletAddress: normalized });
  }
  return user;
}

/**
 * Invalidates the marketplace read caches for a listing after an indexed
 * on-chain event changes it, so `GET /api/prompts` and per-prompt reads
 * regenerate a fresh ETag on the next request instead of serving stale data.
 */
async function invalidatePromptCaches(promptId: string): Promise<void> {
  await Promise.all([
    cacheDelPattern("prompts:list:*"),
    cacheDel(CACHE_KEYS.promptDetail(promptId)),
  ]);
}

const CONTRACT_ID = process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID;
const server = new rpc.Server(process.env.PUBLIC_STELLAR_RPC_URL!);

/**
 * Main entry point to start the background indexing process.
 *
 * Polls the PromptHash Soroban contract for new events, mirrors the resulting
 * state into MongoDB, and fans out webhooks for purchases and ownership
 * transfers. Returns early (without starting the loop) when the required RPC /
 * contract configuration is missing, so it is safe to call unconditionally.
 */
export async function startIndexer() {
  await connectDb();

  const state = await IndexerState.findOneAndUpdate(
    { key: "prompt_hash_contract" },
    { $setOnInsert: { lastIndexedLedger: 0 } },
    { upsert: true, new: true },
  );

  logger.info("Soroban event indexer started", {
    action: "startIndexer",
    replicaId: REPLICA_ID,
  });

  setInterval(async () => {
    // Single-flight: skip this tick if the previous one is still running.
    if (tickInFlight) {
      logger.warn("Tick skipped - previous tick still in flight", {
        action: "indexerTick",
      });
      return;
    }

    tickInFlight = true;
    try {
      const latestLedger = await server.getLatestLedger();
      const startLedger = (state.lastIndexedLedger || 0) + 1;

      // Only fetch if there are new ledgers to process.
      if (startLedger > latestLedger.sequence) return;

      const response = await server.getEvents({
        startLedger,
        filters: [{ type: "contract", contractIds: [contractId] }],
      });

      let lastFinalizedLedger = state.lastFinalizedLedger || 0;

      for (const event of response.events) {
        // Skip provisional events — only process finalized transactions
        if (event.inSuccessfulContractInvocation === false) {
          logger.debug("Skipping provisional event", {
            action: "processEvent",
            ledger: event.ledger,
          });
          continue;
        }
        await processEvent(event);
        lastFinalizedLedger = Math.max(lastFinalizedLedger, event.ledger || 0);
      }

      // Fence: only commit the checkpoint if we still hold the same lease epoch.
      // A stale replica that woke up after expiry is rejected here.
      const current = await IndexerState.findOne({
        key: "prompt_hash_contract",
      });
      if (!current || current.fencingToken !== myToken) {
        logger.warn("Fencing token mismatch - checkpoint discarded", {
          action: "indexerTick",
        });
        return;
      }

      // Update cursors: track both indexed and finalized ledgers separately
      // for fork recovery and ensuring only finalized events are processed
      state.lastIndexedLedger = latestLedger.sequence;
      if (lastFinalizedLedger > 0) {
        state.lastFinalizedLedger = lastFinalizedLedger;
      }
      await state.save();
    } catch (err) {
      logger.error("Indexer error", { action: "indexerTick", error: err });
    } finally {
      tickInFlight = false;
    }
  }, POLL_INTERVAL_MS);
}

/**
 * Persists raw undecodable or unsupported contract events into quarantine with full metadata (#654).
 * Emits alerts and updates indexer quarantine state without advancing a lossy checkpoint.
 */
export async function quarantineEvent(
  event: StellarRpc.Api.EventResponse,
  reason:
    | "unknown_type"
    | "unsupported_version"
    | "malformed_xdr"
    | "decoder_error"
    | "processing_error",
  errorDetails?: string,
  rawTopic?: unknown,
  rawData?: unknown,
): Promise<void> {
  const topicStr = rawTopic !== undefined ? String(rawTopic) : "unknown";
  logger.warn("Quarantining unsupported or malformed contract event", {
    action: "quarantineEvent",
    eventId: event.id,
    ledger: event.ledger,
    topic: topicStr,
    reason,
    error: errorDetails,
  });

  await QuarantinedEvent.findOneAndUpdate(
    { eventId: event.id },
    {
      $set: {
        eventId: event.id,
        ledger: event.ledger,
        txHash: event.txHash || "",
        contractId: event.contractId,
        topic: topicStr,
        rawTopic,
        rawValue: rawData,
        reason,
        status: "quarantined",
        errorDetails,
        quarantinedAt: new Date(),
      },
      $inc: { retryCount: 1 },
    },
    { upsert: true, new: true },
  );

  await IndexerState.findOneAndUpdate(
    { key: "prompt_hash_contract" },
    {
      $inc: { quarantinedCount: 1 },
      $addToSet: { quarantinedLedgers: event.ledger },
    },
  );
}

/**
 * Decodes and routes a Soroban event to the appropriate database action and
 * webhook notification.
 */
async function processEvent(event: rpc.Api.EventResponse) {
  // Decode the topic and value from XDR to Native JS types
  const topic = scValToNative(event.topic[0]);
  const data = scValToNative(event.value);

  // 3. Decode event against schema
  let decoded;
  try {
    decoded = decodeEvent(String(rawTopic), rawData);
  } catch (err: any) {
    await quarantineEvent(
      event,
      "decoder_error",
      err?.message || String(err),
      rawTopic,
      rawData,
    );
    return;
  }

  if (!decoded.recognized) {
    await quarantineEvent(event, decoded.reason, undefined, rawTopic, rawData);
    return;
  }

  // 4. Route decoded event to database projections
  try {
    await routeDecodedEvent(
      decoded.type,
      decoded.data as Record<string, any>,
      event.id,
      txHash,
      event.ledger,
    );
  } catch (err: any) {
    await quarantineEvent(
      event,
      "processing_error",
      err?.message || String(err),
      rawTopic,
      rawData,
    );
  }
}

/**
 * Executes projections for recognized decoded contract events.
 */
export async function routeDecodedEvent(
  topic: string,
  data: Record<string, any>,
  eventId: string,
  txHash?: string,
  ledger?: number,
): Promise<void> {
  logger.info("Processing event", { action: "processEvent", topic });

  switch (topic) {
    case "PromptCreated": {
      const { prompt_id, creator, price_stroops } = data;
      const promptId = prompt_id.toString();
      const initialPrice = Number(price_stroops) / 10_000_000;

      const user = await ensureUser(creator);

      // Upsert the prompt record (handles off-platform creation)
      const prompt = await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        {
          $set: {
            onChainId: promptId,
            owner: user._id,
            price: initialPrice,
            isActive: true,
          },
        },
        { upsert: true, new: true },
      );

      // Mirror into the search index
      await MarketplaceIndex.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        {
          $set: {
            onChainId: prompt_id.toString(),
            promptId: prompt._id,
            title: prompt.title ?? "",
            category: prompt.category ?? "Other",
            price: Number(price_stroops) / 10_000_000,
            ownerWallet: creator.toLowerCase(),
            ownerUsername: user.username ?? "",
            rating: prompt.rating ?? 1,
            isActive: true,
            image: prompt.image ?? "",
          },
          $setOnInsert: { salesCount: 0 },
        },
        { upsert: true },
      );

      // Run similarity scan asynchronously — never block the indexer loop.
      if (upserted?.content) {
        const combinedText = `${upserted.title ?? ""} ${upserted.content}`;
        scanForSimilarity(promptId, combinedText, upserted.category).catch(
          (err) =>
            logger.error("Similarity scan error", {
              action: "similarityScan",
              promptId,
              error: err,
            }),
        );
      }

      // Run the prompt safety scanner asynchronously (#758) — queued or
      // blocked prompts are hidden from the public marketplace until a
      // maintainer overrides. The encrypted payload never enters the scanner.
      if (upserted) {
        applySafetyScan(promptId, {
          title: upserted.title,
          description: upserted.description,
          category: upserted.category,
          tags: upserted.tags,
          preview: upserted.preview,
          payload: upserted.encryptedPrompt ?? undefined,
        }).catch((err) =>
          logger.error("Safety scan error", { action: "safetyScan", promptId, error: err }),
        );
      }
      await invalidatePromptCaches(promptId);
      break;
    }

    case "PromptPurchased": {
      const { prompt_id, buyer, version_index, price_stroops } = data;
      const promptId = prompt_id.toString();

      const prompt = await Prompt.findOneAndUpdate(
        { onChainId: promptId },
        { $inc: { salesCount: 1 } },
        { new: true },
      ).populate("owner", "walletAddress");

      if (buyer) {
        const buyerWallet = String(buyer).toLowerCase();
        const purchaseDoc = await Purchase.findOneAndUpdate(
          { promptId, buyerWallet, txHash: txHash ?? "" },
          {
            $set: {
              promptId,
              buyerWallet,
              versionIndex:
                version_index !== undefined ? Number(version_index) : 0,
              txHash: txHash ?? "",
            },
          },
          { upsert: true, new: true },
        );
        // Freeze the license terms active at purchase time (#759).
        // Fire-and-forget: snapshotting must never block or fail indexing.
        snapshotLicenseForPurchase(
          promptId,
          buyerWallet,
          String(purchaseDoc?._id ?? ""),
        ).catch((err) =>
          logger.error("license snapshot hook failed", {
            action: "indexer",
            promptId,
            error: err,
          }),
        );
      }

      const ownerWallet = (prompt?.owner as { walletAddress?: string } | null)
        ?.walletAddress;
      const promptTitle = (prompt as { title?: string } | null)?.title ?? "";

      await notify(
        ownerWallet,
        "PromptPurchased",
        {
          promptId,
          buyer: buyer ? String(buyer) : undefined,
          priceStroops: price_stroops ? String(price_stroops) : undefined,
          txHash,
        },
        eventId,
      );

      // In-app notifications: buyer gets purchase_confirmed; creator gets
      // a sale alert via the same event. Both use the on-chain event id as
      // the idempotency key (suffixed per-wallet by fanOutNotification).
      const buyerAddr = buyer ? String(buyer) : null;
      if (buyerAddr) {
        await createNotification({
          recipientWallet: buyerAddr,
          type: "purchase_confirmed",
          message: `Your purchase of "${promptTitle || promptId}" was confirmed on-chain.`,
          deepLink: `/prompts/${promptId}`,
          promptId,
          promptTitle,
          idempotencyKey: `${eventId}:buyer:${buyerAddr.toLowerCase()}`,
        }).catch((err) =>
          logger.error("Failed to create purchase_confirmed notification", {
            action: "indexer",
            error: err,
          }),
        );
      }
      if (ownerWallet) {
        await createNotification({
          recipientWallet: ownerWallet,
          type: "purchase_confirmed",
          message: `Someone purchased your prompt "${promptTitle || promptId}".`,
          deepLink: `/creator/analytics`,
          promptId,
          promptTitle,
          idempotencyKey: `${eventId}:creator:${ownerWallet.toLowerCase()}`,
        }).catch((err) =>
          logger.error("Failed to create sale notification for creator", {
            action: "indexer",
            error: err,
          }),
        );
      }

      await invalidatePromptCaches(promptId);
      await invalidateEntitlementCacheForPrompt(promptId);
      break;
    }

    case "PromptOwnershipTransferred": {
      const { prompt_id, from, to } = data;
      const promptId = prompt_id.toString();

      const newOwner = to ? await ensureUser(String(to)) : null;
      if (newOwner) {
        await Prompt.findOneAndUpdate(
          { onChainId: promptId },
          { $set: { owner: newOwner._id } },
        );
      }

      const payload = {
        promptId,
        from: from ? String(from) : undefined,
        to: to ? String(to) : undefined,
        txHash,
      };
      await notify(
        from ? String(from) : undefined,
        "PromptOwnershipTransferred",
        payload,
        eventId,
      );
      await notify(
        to ? String(to) : undefined,
        "PromptOwnershipTransferred",
        payload,
        eventId,
      );

      // In-app notifications for both parties.
      const transferredPrompt = await Prompt.findOne({
        onChainId: promptId,
      }).lean();
      const transferTitle =
        (transferredPrompt as { title?: string } | null)?.title ?? promptId;
      await fanOutNotification(
        [from ? String(from) : null, to ? String(to) : null],
        {
          type: "ownership_transfer",
          message: `Ownership of "${transferTitle}" was transferred on-chain.`,
          deepLink: `/prompts/${promptId}`,
          promptId,
          promptTitle: transferTitle,
          idempotencyKey: eventId,
        },
      ).catch((err) =>
        logger.error("Failed to create ownership_transfer notifications", {
          action: "indexer",
          error: err,
        }),
      );
      await MarketplaceIndex.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $inc: { salesCount: 1 } },
      );
      break;
    }

    case "PromptPriceUpdated": {
      const { prompt_id, price_stroops } = data;
      const newPrice = Number(price_stroops) / 10_000_000;
      await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $set: { price: newPrice } },
      );
      await MarketplaceIndex.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $set: { price: newPrice } },
      );
      break;
    }

    case "PromptSaleStatusUpdated": {
      const { prompt_id, active } = data;
      const promptId = prompt_id.toString();
      await Prompt.findOneAndUpdate(
        { onChainId: promptId },
        { $set: { isActive: active } },
      );
      await invalidatePromptCaches(promptId);
      break;
    }

    case "DisputeOpened": {
      const { prompt_id, buyer } = data;
      const promptId = prompt_id.toString();
      const buyerWallet = String(buyer).toLowerCase();

      await Purchase.findOneAndUpdate(
        { promptId, buyerWallet },
        { $set: { status: "disputed" } },
      );

      // An on-chain dispute is the buyer's refund request for an off-chain
      // dispute record, if one exists (#755). Keyed by event id so a replayed
      // event is a no-op.
      await applyDisputeTransition({
        promptId,
        buyerWallet,
        event: "refund_requested",
        actor: "indexer",
        note: "Dispute opened on-chain",
        eventKey: `chain:${eventId}`,
        set: txHash ? { disputeTxHash: txHash } : undefined,
      });

      invalidateEntitlementCacheForPrompt(promptId);
      await invalidatePromptCaches(promptId);

      await notify(
        buyerWallet,
        "DisputeOpened",
        {
          promptId,
          buyer: String(buyer),
          txHash,
        },
        eventId,
      );
      break;
    }

    case "DisputeResolved": {
      const { prompt_id, buyer, refunded } = data;
      const promptId = prompt_id.toString();
      const buyerWallet = String(buyer).toLowerCase();

      const resolution = refunded ? "refunded" : "rejected";

      await Purchase.findOneAndUpdate(
        { promptId, buyerWallet },
        {
          $set: {
            status: "resolved",
            disputeResolution: resolution,
          },
        },
      );

      if (refunded) {
        // Escrowed funds went back to the buyer: settle the off-chain dispute
        // record too (#755). Idempotent if a maintainer already approved it.
        await applyDisputeTransition({
          promptId,
          buyerWallet,
          event: "refund_settled",
          actor: "indexer",
          note: "Refund settled on-chain",
          eventKey: `chain:${eventId}`,
          set: txHash ? { resolutionTxHash: txHash } : undefined,
        });
      }

      invalidateEntitlementCacheForPrompt(promptId);
      await invalidatePromptCaches(promptId);

      await notify(
        buyerWallet,
        "DisputeResolved",
        {
          promptId,
          buyer: String(buyer),
          refunded,
          txHash,
        },
        eventId,
      );
      break;
    }

    default:
      logger.debug("Unhandled event topic", { action: "processEvent", topic });
      break;
  }
}
