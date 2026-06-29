import { rpc as StellarRpc, scValToNative } from "@stellar/stellar-sdk";
import Prompt from "../models/Prompt";
import User from "../models/User";
import Purchase from "../models/Purchase";
import { IndexerState } from "../models/IndexerState";
import { scanForSimilarity } from "./similarityDetection";
import { dispatchEvent } from "./webhookDispatcher";

const POLL_INTERVAL_MS = 5_000;

/**
 * Resolves a wallet address to a User document, creating a lightweight record
 * if one does not exist yet (e.g. prompts created or acquired off-platform).
 */
async function ensureUser(walletAddress: string) {
  const normalized = walletAddress.toLowerCase();
  let user = await User.findOne({ walletAddress: normalized });
  if (!user) {
    user = await User.create({
      walletAddress: normalized,
      username: `user_${walletAddress.slice(0, 6)}`,
      rating: 4,
    });
  }
  return user;
}

/** Fires a webhook to a creator/owner wallet, swallowing delivery errors. */
async function notify(
  wallet: string | undefined | null,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!wallet) return;
  try {
    await dispatchEvent(wallet, event, data);
  } catch (err) {
    console.error(`[indexer] Webhook dispatch failed for ${event}:`, err);
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

  console.log("[indexer] Soroban event indexer started.");

  setInterval(async () => {
    try {
      const latestLedger = await server.getLatestLedger();
      const startLedger = (state.lastIndexedLedger || 0) + 1;

      // Only fetch if there are new ledgers to process.
      if (startLedger > latestLedger.sequence) return;

      const response = await server.getEvents({
        startLedger,
        filters: [{ type: "contract", contractIds: [contractId] }],
      });

      for (const event of response.events) {
        await processEvent(event);
      }

      // Update the cursor to the last processed ledger.
      state.lastIndexedLedger = latestLedger.sequence;
      await state.save();
    } catch (err) {
      console.error("Indexer Error:", err);
    }
  }, POLL_INTERVAL_MS);
}

/**
 * Decodes and routes a Soroban event to the appropriate database action and
 * webhook notification.
 */
async function processEvent(event: StellarRpc.Api.EventResponse): Promise<void> {
  // Decode the topic and value from XDR to native JS types.
  const topic = scValToNative(event.topic[0]);
  const data = scValToNative(event.value);
  const txHash = event.txHash;

  console.log(`Processing Event: ${topic}`, data);

  switch (topic) {
    case "PromptCreated": {
      const { prompt_id, creator, price_stroops } = data;

      const user = await ensureUser(creator);

      // handles discovery of prompts created off-platform
      const upserted = await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        {
          $set: {
            onChainId: prompt_id.toString(),
            owner: user._id,
            price: Number(price_stroops) / 10_000_000,
            isActive: true,
          },
        },
        { upsert: true, new: true },
      );

      // Run similarity scan asynchronously — never block the indexer loop.
      if (upserted?.content) {
        const combinedText = `${upserted.title ?? ""} ${upserted.content}`;
        scanForSimilarity(prompt_id.toString(), combinedText).catch((err) =>
          console.error("[similarity] Scan error for prompt", prompt_id.toString(), err),
        );
      }
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
      await notify(ownerWallet, "PromptPurchased", {
        promptId,
        buyer: buyer ? String(buyer) : undefined,
        priceStroops: price_stroops ? String(price_stroops) : undefined,
        txHash,
      });
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
      await notify(from ? String(from) : undefined, "PromptOwnershipTransferred", payload);
      await notify(to ? String(to) : undefined, "PromptOwnershipTransferred", payload);
      break;
    }

    case "PromptPriceUpdated": {
      const { prompt_id, price_stroops } = data;
      await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $set: { price: Number(price_stroops) / 10_000_000 } },
      );
      break;
    }

    case "PromptSaleStatusUpdated": {
      const { prompt_id, active } = data;
      await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $set: { isActive: active } },
      );
      break;
    }

    default:
      console.log(`Unhandled event topic: ${topic}`);
      break;
  }
}
