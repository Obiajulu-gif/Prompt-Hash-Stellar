import os from "os";
import { rpc as StellarRpc, scValToNative } from "@stellar/stellar-sdk";
import Prompt from "../models/Prompt";
import User from "../models/User";
import Purchase from "../models/Purchase";
import PriceChange from "../models/PriceChange";
import { IndexerState } from "../models/IndexerState";
import ProcessedEvent from "../models/ProcessedEvent";
import { scanForSimilarity } from "./similarityDetection";
import { enqueue as enqueueWebhookEvent } from "./webhookOutbox";
import { cacheDel, cacheDelPattern, CACHE_KEYS } from "./cacheService";
import { decodeEvent } from "../../../packages/sdk/src/events/decode.js";

const POLL_INTERVAL_MS = 5_000;
const LEASE_TTL_MS = 30_000; // lease expires after 30 s of inactivity
const REPLICA_ID = `${process.pid}@${os.hostname()}`;

let tickInFlight = false; // single-flight guard for the current process

// Entitlement decision cache — invalidated on settlement events (#545).
// Short TTL balances freshness with RPC load.
const entitlementCache = new Map<string, { decision: boolean; cachedAt: number }>();
const ENTITLEMENT_CACHE_TTL_MS = 30_000;

function invalidateEntitlementCacheForPrompt(promptId: string): void {
  const prefix = `entitlement:${promptId}:`;
  for (const key of entitlementCache.keys()) {
    if (key.startsWith(prefix)) {
      entitlementCache.delete(key);
    }
  }
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
    console.error(`[indexer] Webhook enqueue failed for ${event}:`, err);
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
    console.warn(
      "[indexer] PUBLIC_STELLAR_RPC_URL or PUBLIC_PROMPT_HASH_CONTRACT_ID not set — Soroban indexer disabled.",
    );
    return;
  }

  const server = new StellarRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });

  const state = await IndexerState.findOneAndUpdate(
    { key: "prompt_hash_contract" },
    { $setOnInsert: { lastIndexedLedger: 0 } },
    { upsert: true, new: true },
  );

  console.log("[indexer] Soroban event indexer started.", { replicaId: REPLICA_ID });

  setInterval(async () => {
    // Single-flight: skip this tick if the previous one is still running.
    if (tickInFlight) {
      console.warn("[indexer] Tick skipped — previous tick still in flight.");
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
        if (event.inSuccessfulContractInvocation === false) {
          console.log(`[indexer] Skipping provisional event from ledger ${event.ledger}`);
          continue;
        }
        await processEvent(event);
        lastFinalizedLedger = Math.max(lastFinalizedLedger, event.ledger || 0);
      }

      // Fence: only commit the checkpoint if we still hold the same lease epoch.
      // A stale replica that woke up after expiry is rejected here.
      const current = await IndexerState.findOne({ key: "prompt_hash_contract" });
      if (!current || current.fencingToken !== myToken) {
        console.warn("[indexer] Fencing token mismatch — checkpoint discarded.");
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
      console.error("Indexer Error:", err);
    } finally {
      tickInFlight = false;
    }
  }, POLL_INTERVAL_MS);
}

/**
 * Decodes and routes a Soroban event to the appropriate database action and
 * webhook notification.
 */
export async function processEvent(event: StellarRpc.Api.EventResponse): Promise<void> {
  // Decode the topic and value from XDR to native JS types.
  const rawTopic = scValToNative(event.topic[0]);
  const rawData = scValToNative(event.value);
  const txHash = event.txHash;

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
      console.log(`[indexer] Skipping duplicate event ${event.id}`);
      return;
    }
    throw err;
  }

  const decoded = decodeEvent(String(rawTopic), rawData);
  if (!decoded.recognized) {
    console.log(`[indexer] Unrecognized event: ${rawTopic} (reason: ${decoded.reason})`, rawData);
    return;
  }

  const topic = decoded.type;
  const data = decoded.data as Record<string, any>;

  console.log(`Processing Event: ${topic} (v${decoded.version})`, data);

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
        scanForSimilarity(promptId, combinedText).catch((err) =>
          console.error("[similarity] Scan error for prompt", promptId, err),
        );
      }
      await invalidatePromptCaches(promptId);
      break;
    }

    case "PromptPurchased": {
      // The contract event always carries the prompt id; buyer / version /
      // price fields are parsed defensively so a record is created whenever the
      // chain provides them.
      const { prompt_id, buyer, version_index, price_stroops } = data;
      const promptId = prompt_id.toString();

      const prompt = await Prompt.findOneAndUpdate(
        { onChainId: promptId },
        { $inc: { salesCount: 1 } },
        { new: true },
      ).populate("owner", "walletAddress");

      // Record the individual purchase so it surfaces in buyer transaction
      // history. De-duplicated on (promptId, buyerWallet, txHash) to keep the
      // poll loop idempotent if the same ledger range is re-scanned.
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
        event.id,
      );
      await invalidatePromptCaches(promptId);
      // Invalidate entitlement cache on settlement (refund/transfer)
      invalidateEntitlementCacheForPrompt(promptId);
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

      // Notify both the previous and the new owner of the transfer.
      const payload = {
        promptId,
        from: from ? String(from) : undefined,
        to: to ? String(to) : undefined,
        txHash,
      };
      await notify(from ? String(from) : undefined, "PromptOwnershipTransferred", payload, event.id);
      await notify(to ? String(to) : undefined, "PromptOwnershipTransferred", payload, event.id);
      await invalidatePromptCaches(promptId);
      break;
    }

    case "PromptPriceUpdated": {
      const { prompt_id, price_stroops } = data;
      const promptId = prompt_id.toString();
      const newPrice = Number(price_stroops) / 10_000_000;

      // Read the current price before updating so we can record the delta.
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
          ledgerSeq: event.ledger ?? null,
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

    default:
      console.log(`Unhandled event topic: ${topic}`);
      break;
  }
}
