import "dotenv/config";
import mongoose from "mongoose";
import connectDb from "../src/db/connectDb.js";
import { repairEntitlementForPurchase } from "../src/services/entitlementService";

function parseArgs(args: string[]): { purchaseId: string; apply: boolean } {
  let purchaseId: string | undefined;
  let apply = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--purchase-id" && args[index + 1]) {
      purchaseId = args[++index];
    } else if (arg === "--help") {
      console.info(
        "Usage: npm run repair:entitlement -- --purchase-id <object-id> [--apply]\n" +
          "Defaults to dry-run; --apply persists the repair and audit record.",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (!purchaseId) throw new Error("--purchase-id is required");
  return { purchaseId, apply };
}

async function main(): Promise<void> {
  const { purchaseId, apply } = parseArgs(process.argv.slice(2));
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI must be set before repairing an entitlement");
  }

  await connectDb();
  try {
    const result = await repairEntitlementForPurchase(purchaseId, {
      apply,
      actor: process.env.REPAIR_ACTOR || process.env.USERNAME || "manual-cli",
    });
    console.info(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[entitlement-repair] failed", error);
  process.exitCode = 1;
});