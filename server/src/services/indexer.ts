import { SorobanRpc, scValToNative } from "@stellar/stellar-sdk";
import Prompt from "../models/Prompt";
import User from "../models/User";
import { IndexerState } from "../models/IndexerState";

const CONTRACT_ID = process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID;
const rpc = new SorobanRpc.Server(process.env.PUBLIC_STELLAR_RPC_URL!);

/**
 * Main entry point to start the background indexing process.
 */
export async function startIndexer() {
  const state = await IndexerState.findOneAndUpdate(
    { key: "prompt_hash_contract" },
    { $setOnInsert: { lastIndexedLedger: 0 } },
    { upsert: true, new: true },
  );

  // Poll every 5 seconds
  setInterval(async () => {
    try {
      const latestLedger = await rpc.getLatestLedger();
      const startLedger = (state.lastIndexedLedger || 0) + 1;

      // Only fetch if there are new ledgers to process
      if (startLedger > latestLedger.sequence) return;

      const response = await rpc.getEvents({
        startLedger,
        filters: [
          {
            type: "contract",
            contractIds: [CONTRACT_ID!],
          },
        ],
      });

      for (const event of response.events) {
        await processEvent(event);
      }

      // Update the cursor to the last processed ledger
      state.lastIndexedLedger = latestLedger.sequence;
      await state.save();
    } catch (err) {
      console.error("Indexer Error:", err);
    }
  }, 5000);
}

/**
 * Decodes and routes Soroban events to the appropriate database action.
 */
async function processEvent(event: SorobanRpc.Api.EventResponse) {
  // Decode the topic and value from XDR to Native JS types
  const topic = scValToNative(event.topic[0]);
  const data = scValToNative(event.value);

  console.log(`Processing Event: ${topic}`, data);

  switch (topic) {
    case "PromptCreated": {
      const { prompt_id, creator, price_stroops } = data;

      // Ensure the creator exists in our User collection
      let user = await User.findOne({ walletAddress: creator.toLowerCase() });
      if (!user) {
        user = await User.create({
          walletAddress: creator.toLowerCase(),
          username: `user_${creator.slice(0, 6)}`,
          rating: 4,
        });
      }

      // handles discovery of prompts created off-platform
      await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        {
          $set: {
            onChainId: prompt_id.toString(),
            owner: user._id,
            price: Number(price_stroops) / 10_000_000,
            isActive: true,
          },
        },
        { upsert: true },
      );
      break;
    }

    case "PromptPurchased": {
      const { prompt_id } = data;
      await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $inc: { salesCount: 1 } },
      );
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
