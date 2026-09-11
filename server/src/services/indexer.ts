import os from "os";
import { rpc as StellarRpc, scValToNative } from "@stellar/stellar-sdk";
import Prompt from "../models/Prompt";
import User from "../models/User";
import Purchase from "../models/Purchase";
import PriceChange from "../models/PriceChange";
import { IndexerState } from "../models/IndexerState";
import ProcessedEvent from "../models/ProcessedEvent";
import QuarantinedEvent from "../models/QuarantinedEvent";
import { scanForSimilarity } from "./similarityDetection";
import { enqueue as enqueueWebhookEvent } from "./webhookOutbox";
import {
  cacheDel,
  cacheDelPattern,
  cacheGetJson,
  cacheSetJson,
  CACHE_KEYS,
  invalidatePromptCaches,
  METADATA_TTL_SECONDS,
} from "./cacheService";
import { logger } from "./structuredLogger";

let cachedDecodeEvent: ((topic: string, data: unknown) => any) | null = null;
async function getEventDecoder(): Promise<(topic: string, data: unknown) => any> {
  if (!cachedDecodeEvent) {
    const sdk = await import("@prompthash/sdk" as string);
    cachedDecodeEvent = sdk.decodeEvent;
  }
  return cachedDecodeEvent!;
}

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
 * Cached prompt metadata retrieval for indexing service to reduce DB / RPC overhead.
 */
export async function getCachedPromptMetadata<T>(promptId: string): Promise<T | null> {
  return cacheGetJson<T>(CACHE_KEYS.promptMetadata(promptId));
}

/**
 * Cache indexed prompt metadata.
 */
export async function cachePromptMetadata<T>(
  promptId: string,
  metadata: T,
  ttlSeconds = METADATA_TTL_SECONDS,
): Promise<void> {
  await cacheSetJson(CACHE_KEYS.promptMetadata(promptId), metadata, ttlSeconds);
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
 * Enqueues a durable webhook delivery for a creator/owner wallet, swallowing
 * enqueue errors so a webhook problem never blocks indexing. `dedupeKey` is
 * the chain event's own id — the indexer is the sole projector of on-chain
 * marketplace events into webhooks (#536), so this is a stable identity a
 * re-scanned ledger range can't double-enqueue.
 */
async function notify(
  wallet: string | undefined | null,
  event: string,
  data: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> {
  if (!wallet) return;
  try {
    await enqueueWebhookEvent(wallet, event, data, dedupeKey);
  } catch (err) {
    logger.error("Webhook enqueue failed", { action: "indexer", event, error: err });
  }
}

/**
 * Main entry point to start the background indexing process.
 *
 * Polls the PromptHash Soroban contract for new events, mirrors the resulting
 * state into MongoDB, and fans out webhooks for purchases and ownership
 * transfers. Returns early (without starting the loop) when the required RPC /
 * contract configuration is missing, so it is safe to call unconditionally.
 */
export async function startIndexer(): Promise<void> {
  const rpcUrl = process.env.PUBLIC_STELLAR_RPC_URL;
  const contractId = process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID;

  if (!rpcUrl || !contractId) {
    logger.warn("Soroban indexer disabled - missing configuration", { action: "startIndexer" });
    return;
  }

  const server = new StellarRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });

  const state = await IndexerState.findOneAndUpdate(
    { key: "prompt_hash_contract" },
    { $setOnInsert: { lastIndexedLedger: 0 } },
    { upsert: true, new: true },
  );

  logger.info("Soroban event indexer started", { action: "startIndexer", replicaId: REPLICA_ID });

  setInterval(async () => {
    // Single-flight: skip this tick if the previous one is still running.
    if (tickInFlight) {
      logger.warn("Tick skipped - previous tick still in flight", { action: "indexerTick" });
      return;
    }

    tickInFlight = true;
    try {
      // Acquire or renew the distributed lease via a compare-and-swap write.
      // Only one replica holds the lease at a time; others skip their tick.
      const now = new Date();
      const leaseExpiry = new Date(now.getTime() + LEASE_TTL_MS);

      const leased = await IndexerState.findOneAndUpdate(
        {
          key: "prompt_hash_contract",
          $or: [
            { leaseHolder: REPLICA_ID },                  // we already hold it
            { leaseExpiresAt: { $lt: now } },             // it has expired
            { leaseHolder: null },                        // nobody holds it
          ],
        },
        {
          $set: { leaseHolder: REPLICA_ID, leaseExpiresAt: leaseExpiry },
          $inc: { fencingToken: 1 },
        },
        { new: true },
      );

      if (!leased) {
        // Another replica holds a valid lease — yield this tick.
        return;
      }

      const myToken = leased.fencingToken;

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
        if ((event as any).inSuccessfulContractInvocation === false || (event as any).inSuccessfulContractCall === false) {
          logger.debug("Skipping provisional event", { action: "processEvent", ledger: event.ledger });
          continue;
        }
        await processEvent(event);
        lastFinalizedLedger = Math.max(lastFinalizedLedger, event.ledger || 0);
      }

      // Fence: only commit the checkpoint if we still hold the same lease epoch.
      // A stale replica that woke up after expiry is rejected here.
      const current = await IndexerState.findOne({ key: "prompt_hash_contract" });
      if (!current || current.fencingToken !== myToken) {
        logger.warn("Fencing token mismatch - checkpoint discarded", { action: "indexerTick" });
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
  reason: "unknown_type" | "unsupported_version" | "malformed_xdr" | "decoder_error" | "processing_error",
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
export async function processEvent(event: StellarRpc.Api.EventResponse): Promise<void> {
  let rawTopic: unknown;
  let rawData: unknown;

  // 1. Defensively decode XDR to native types. If malformed, quarantine immediately.
  if (
    !event.topic ||
    !Array.isArray(event.topic) ||
    event.topic.length === 0 ||
    event.topic[0] === null ||
    event.topic[0] === undefined
  ) {
    await quarantineEvent(event, "malformed_xdr", "Missing or null event topic");
    return;
  }

  try {
    rawTopic =
      typeof (event.topic[0] as any)?.switch === "function"
        ? scValToNative(event.topic[0])
        : typeof event.topic[0] === "object" && event.topic[0] !== null && "value" in event.topic[0]
          ? (event.topic[0] as any).value
          : event.topic[0];
    rawData =
      event.value && typeof (event.value as any)?.switch === "function"
        ? scValToNative(event.value)
        : event.value !== null && typeof event.value === "object" && "value" in event.value
          ? (event.value as any).value
          : event.value;
  } catch (err: any) {
    await quarantineEvent(event, "malformed_xdr", err?.message || String(err));
    return;
  }

  const txHash = event.txHash;

  // 2. Mark event processed for idempotency
  try {
    await ProcessedEvent.create({
      eventId: event.id,
      ledger: event.ledger,
      txHash: txHash || "",
      contractId: event.contractId,
      topic: String(rawTopic),
    });
  } catch (err: any) {
    if (err.code === 11000) {
      logger.debug("Skipping duplicate event", { action: "processEvent", eventId: event.id });
      return;
    }
    throw err;
  }

  // 3. Decode event against schema
  let decoded;
  try {
    const decodeFn = await getEventDecoder();
    decoded = decodeFn(String(rawTopic), rawData);
  } catch (err: any) {
    await quarantineEvent(event, "decoder_error", err?.message || String(err), rawTopic, rawData);
    return;
  }

  if (!decoded.recognized) {
    await quarantineEvent(event, decoded.reason, undefined, rawTopic, rawData);
    return;
  }

  // 4. Route decoded event to database projections
  try {
    await routeDecodedEvent(decoded.type, decoded.data as Record<string, any>, event.id, txHash, event.ledger);
  } catch (err: any) {
    await quarantineEvent(event, "processing_error", err?.message || String(err), rawTopic, rawData);
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

      // handles discovery of prompts created off-platform
      const upserted = await Prompt.findOneAndUpdate(
        { onChainId: promptId },
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

      // Record the initial price as the first entry in the price history.
      await PriceChange.findOneAndUpdate(
        { promptId, ledgerSeq: 0 },
        {
          $set: {
            promptId,
            previousPrice: null,
            newPrice: initialPrice,
            asset: "XLM",
            ledgerSeq: 0,
          },
        },
        { upsert: true },
      );

      // Run similarity scan asynchronously — never block the indexer loop.
      if (upserted?.content) {
        const combinedText = `${upserted.title ?? ""} ${upserted.content}`;
        scanForSimilarity(promptId, combinedText, upserted.category).catch((err) =>
          logger.error("Similarity scan error", { action: "similarityScan", promptId, error: err }),
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
        await Purchase.findOneAndUpdate(
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
          { upsert: true },
        );
      }

      const ownerWallet = (prompt?.owner as { walletAddress?: string } | null)
        ?.walletAddress;
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
      await notify(from ? String(from) : undefined, "PromptOwnershipTransferred", payload, eventId);
      await notify(to ? String(to) : undefined, "PromptOwnershipTransferred", payload, eventId);
      await invalidatePromptCaches(promptId);
      break;
    }

    case "PromptPriceUpdated": {
      const { prompt_id, price_stroops } = data;
      const promptId = prompt_id.toString();
      const newPrice = Number(price_stroops) / 10_000_000;

      const current = await Prompt.findOne({ onChainId: promptId });
      const previousPrice = current?.price ?? null;

      await Promise.all([
        Prompt.findOneAndUpdate(
          { onChainId: promptId },
          { $set: { price: newPrice } },
        ),
        PriceChange.create({
          promptId,
          previousPrice,
          newPrice,
          asset: "XLM",
          ledgerSeq: ledger ?? null,
          txHash: txHash ?? "",
        }),
      ]);
      await invalidatePromptCaches(promptId);
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

    case "PromptUpdated": {
      const { prompt_id, version } = data;
      const promptId = prompt_id.toString();

      if (version !== undefined) {
        await Prompt.findOneAndUpdate(
          { onChainId: promptId },
          { $set: { currentVersionIndex: Number(version) } },
        );
      }

      await invalidatePromptCaches(promptId);
      logger.info("Prompt updated on-chain, invalidated caches", {
        action: "processEvent",
        topic: "PromptUpdated",
        promptId,
        version,
      });
      break;
    }

    case "ListingRevised": {
      const { prompt_id, new_revision } = data;
      const promptId = prompt_id.toString();

      if (new_revision !== undefined) {
        await Prompt.findOneAndUpdate(
          { onChainId: promptId },
          { $set: { currentRevision: Number(new_revision) } },
        );
      }

      await invalidatePromptCaches(promptId);
      logger.info("Listing revised, invalidated caches", {
        action: "processEvent",
        topic: "ListingRevised",
        promptId,
      });
      break;
    }

    case "ListingExtended": {
      const { prompt_id } = data;
      const promptId = prompt_id.toString();
      await invalidatePromptCaches(promptId);
      break;
    }

    case "SplitsUpdated": {
      const { prompt_id } = data;
      const promptId = prompt_id.toString();
      await invalidatePromptCaches(promptId);
      break;
    }

    case "PromptMaxSupplyUpdated": {
      const { prompt_id, max_supply } = data;
      const promptId = prompt_id.toString();

      if (max_supply !== undefined) {
        await Prompt.findOneAndUpdate(
          { onChainId: promptId },
          { $set: { maxSupply: Number(max_supply) } },
        );
      }

      await invalidatePromptCaches(promptId);
      break;
    }

    default:
      logger.debug("Unhandled event topic", { action: "processEvent", topic });
      break;
  }
}

/**
 * Refreshes the search index and cache for a prompt listing atomically,
 * tracking index status ('pending' -> 'synced' | 'failed') and errors (#699).
 */
export async function refreshPromptIndex(
  promptId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await Prompt.findOneAndUpdate(
      { $or: [{ _id: promptId }, { onChainId: promptId }] },
      { $set: { searchIndexStatus: "pending" } },
    );

    // Invalidate read caches
    await invalidatePromptCaches(promptId);

    // Update to synced
    await Prompt.findOneAndUpdate(
      { $or: [{ _id: promptId }, { onChainId: promptId }] },
      {
        $set: {
          searchIndexStatus: "synced",
          searchIndexError: null,
          lastIndexedAt: new Date(),
        },
      },
    );

    return { success: true };
  } catch (error: any) {
    const errorMsg = error?.message || "Search index refresh failed";
    await Prompt.findOneAndUpdate(
      { $or: [{ _id: promptId }, { onChainId: promptId }] },
      {
        $set: {
          searchIndexStatus: "failed",
          searchIndexError: errorMsg,
        },
      },
    );
    return { success: false, error: errorMsg };
  }
}

/**
 * Retries failed search index refreshes across all prompts (#699)
 */
export async function retryFailedIndexRefreshes(): Promise<{
  retried: number;
  succeeded: number;
}> {
  const failedPrompts = await Prompt.find({ searchIndexStatus: "failed" }).limit(50);
  let succeeded = 0;

  for (const prompt of failedPrompts) {
    const res = await refreshPromptIndex(String(prompt._id));
    if (res.success) {
      succeeded++;
    }
  }

  return { retried: failedPrompts.length, succeeded };
}

/**
 * Replays quarantined events through the event decoder and database projections (#654).
 */
export async function replayQuarantinedEvents(options: { maxEvents?: number } = {}): Promise<{
  replayed: number;
  failed: number;
}> {
  const maxEvents = options.maxEvents || 100;
  const quarantinedEvents = await QuarantinedEvent.find({ status: "quarantined" })
    .sort({ ledger: 1, quarantinedAt: 1 })
    .limit(maxEvents);

  let replayed = 0;
  let failed = 0;
  const decodeFn = await getEventDecoder();

  for (const item of quarantinedEvents) {
    try {
      const decoded = decodeFn(item.topic, item.rawValue);
      if (decoded.recognized) {
        await routeDecodedEvent(
          decoded.type,
          decoded.data as Record<string, any>,
          item.eventId,
          item.txHash,
          item.ledger,
        );
        item.status = "replayed";
        item.replayedAt = new Date();
        await item.save();
        replayed++;
      } else {
        failed++;
      }
    } catch (err: any) {
      item.errorDetails = err?.message || String(err);
      item.retryCount = (item.retryCount || 0) + 1;
      await item.save();
      failed++;
    }
  }

  return { replayed, failed };
}

