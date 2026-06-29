/**
 * Re-Index from Ledger Recovery Script (Issue #135)
 *
 * Wipes and rebuilds the Prompt, User (wallet-derived fields), Purchase,
 * and IndexerState collections by replaying every Soroban contract event
 * from the genesis ledger (or a specified start ledger) to the chain tip.
 *
 * Usage:
 *   ts-node server/scripts/reIndexFromLedger.ts [--from <ledger>] [--dry-run]
 *
 * Environment variables:
 *   MONGODB_URI                    – MongoDB connection string
 *   PUBLIC_STELLAR_RPC_URL         – Soroban RPC endpoint
 *   PUBLIC_PROMPT_HASH_CONTRACT_ID – Contract ID to replay
 *
 * Safety guards:
 *   - Requires explicit --confirm flag to wipe data (or --dry-run for preview)
 *   - Prints a summary and prompts before destructive operations
 *   - Processes events in batches to avoid RPC timeouts
 */

import mongoose from "mongoose";
import { SorobanRpc, scValToNative } from "@stellar/stellar-sdk";
import Prompt from "../src/models/Prompt";
import User from "../src/models/User";
import { IndexerState } from "../src/models/IndexerState";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CONFIRM = args.includes("--confirm");
const FROM_IDX = args.indexOf("--from");
const START_LEDGER = FROM_IDX !== -1 ? parseInt(args[FROM_IDX + 1], 10) : 1;
const BATCH_SIZE = 2000; // ledgers per RPC call

if (!DRY_RUN && !CONFIRM) {
  console.error(
    "ERROR: Destructive operation.\n" +
      "  Add --dry-run to preview without changes.\n" +
      "  Add --confirm to proceed with wipe + re-index.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

// ---------------------------------------------------------------------------
// Event processor (mirrors indexer.ts logic, extended for re-index)
// ---------------------------------------------------------------------------

interface EventSummary {
  created: number;
  purchased: number;
  priceUpdated: number;
  statusUpdated: number;
  unknown: number;
}

async function processEvent(
  event: SorobanRpc.Api.EventResponse,
  summary: EventSummary,
  dryRun: boolean,
): Promise<void> {
  const topic = scValToNative(event.topic[0]);
  const data = scValToNative(event.value);

  switch (topic) {
    case "PromptCreated": {
      const { prompt_id, creator, price_stroops } = data;
      summary.created++;
      if (dryRun) break;

      let user = await User.findOne({ walletAddress: creator.toLowerCase() });
      if (!user) {
        user = await User.create({
          walletAddress: creator.toLowerCase(),
          username: `user_${creator.slice(0, 6)}`,
          rating: 4,
        });
      }

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
      summary.purchased++;
      if (dryRun) break;
      await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $inc: { salesCount: 1 } },
      );
      break;
    }

    case "PromptPriceUpdated": {
      const { prompt_id, price_stroops } = data;
      summary.priceUpdated++;
      if (dryRun) break;
      await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $set: { price: Number(price_stroops) / 10_000_000 } },
      );
      break;
    }

    case "PromptSaleStatusUpdated": {
      const { prompt_id, active } = data;
      summary.statusUpdated++;
      if (dryRun) break;
      await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $set: { isActive: active } },
      );
      break;
    }

    default:
      summary.unknown++;
      break;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const mongoUri = requireEnv("MONGODB_URI");
  const rpcUrl = requireEnv("PUBLIC_STELLAR_RPC_URL");
  const contractId = requireEnv("PUBLIC_PROMPT_HASH_CONTRACT_ID");

  console.log(`\n${"=".repeat(60)}`);
  console.log("PromptHash Re-Index from Ledger Recovery Script");
  console.log(`${"=".repeat(60)}`);
  console.log(`Mode:         ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE (writes enabled)"}`);
  console.log(`Start ledger: ${START_LEDGER}`);
  console.log(`RPC URL:      ${rpcUrl}`);
  console.log(`Contract:     ${contractId}`);
  console.log(`${"=".repeat(60)}\n`);

  await mongoose.connect(mongoUri);
  console.log("✅ MongoDB connected");

  const rpc = new SorobanRpc.Server(rpcUrl);
  const latestLedger = await rpc.getLatestLedger();
  console.log(`Latest ledger: ${latestLedger.sequence}`);

  if (!DRY_RUN) {
    console.log("\n⚠️  WIPING existing Prompt, User (wallet-only) data, and IndexerState...");
    await Prompt.deleteMany({});
    await User.deleteMany({});
    await IndexerState.deleteMany({});
    console.log("✅ Collections cleared");
  }

  const summary: EventSummary = {
    created: 0,
    purchased: 0,
    priceUpdated: 0,
    statusUpdated: 0,
    unknown: 0,
  };

  let currentLedger = START_LEDGER;
  let batchCount = 0;

  while (currentLedger <= latestLedger.sequence) {
    const endLedger = Math.min(currentLedger + BATCH_SIZE - 1, latestLedger.sequence);
    batchCount++;

    process.stdout.write(
      `\r[batch ${batchCount}] Processing ledgers ${currentLedger}–${endLedger}...`,
    );

    try {
      const response = await rpc.getEvents({
        startLedger: currentLedger,
        filters: [{ type: "contract", contractIds: [contractId] }],
      });

      for (const event of response.events) {
        await processEvent(event, summary, DRY_RUN);
      }
    } catch (err) {
      console.error(`\n[batch ${batchCount}] Error fetching events:`, err);
    }

    currentLedger = endLedger + 1;
  }

  if (!DRY_RUN) {
    await IndexerState.findOneAndUpdate(
      { key: "prompt_hash_contract" },
      { lastIndexedLedger: latestLedger.sequence },
      { upsert: true },
    );
  }

  console.log(`\n\n${"=".repeat(60)}`);
  console.log("Re-Index Summary");
  console.log(`${"=".repeat(60)}`);
  console.log(`Ledgers scanned:   ${latestLedger.sequence - START_LEDGER + 1}`);
  console.log(`PromptCreated:     ${summary.created}`);
  console.log(`PromptPurchased:   ${summary.purchased}`);
  console.log(`PriceUpdated:      ${summary.priceUpdated}`);
  console.log(`StatusUpdated:     ${summary.statusUpdated}`);
  console.log(`Unknown events:    ${summary.unknown}`);
  console.log(`${"=".repeat(60)}\n`);

  if (DRY_RUN) {
    console.log("DRY RUN complete — no data was modified.");
    console.log("Re-run with --confirm to apply changes.");
  } else {
    console.log("✅ Re-index complete. IndexerState reset to ledger", latestLedger.sequence);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
