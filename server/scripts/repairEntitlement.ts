import "dotenv/config";
import mongoose from "mongoose";
import connectDb from "../src/db/connectDb.js";
import { repairEntitlementForPurchase } from "../src/services/entitlementService";
import {
  OrphanRepairCheckpoint,
  runResumableOrphanRepair,
} from "../src/services/orphanRepairCheckpoint.js";

interface ParsedArgs {
  purchaseId?: string;
  apply: boolean;
  resume?: string;
  checkpointFile?: string;
  purchaseIds: string[];
  status: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { apply: false, purchaseIds: [], status: false };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--apply") {
      parsed.apply = true;
    } else if (arg === "--purchase-id" && args[index + 1]) {
      parsed.purchaseId = args[++index];
    } else if (arg === "--purchase-ids" && args[index + 1]) {
      parsed.purchaseIds = args[++index]
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
    } else if (arg === "--resume" && args[index + 1]) {
      parsed.resume = args[++index];
    } else if (arg === "--checkpoint-file" && args[index + 1]) {
      parsed.checkpointFile = args[++index];
    } else if (arg === "--status") {
      parsed.status = true;
    } else if (arg === "--help") {
      console.info(
        "Usage:\n" +
          "  npm run repair:entitlement -- --purchase-id <object-id> [--apply]\n" +
          "  npm run repair:entitlement -- --purchase-ids <id1,id2,...> --checkpoint-file <path> [--apply]\n" +
          "  npm run repair:entitlement -- --resume <run-id> --checkpoint-file <path> [--apply]\n" +
          "  npm run repair:entitlement -- --status --checkpoint-file <path>\n" +
          "Defaults to dry-run; --apply persists repairs and audit records.\n" +
          "Batch runs checkpoint after every purchase so an interrupted run can be resumed.",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return parsed;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.status) {
    if (!parsed.checkpointFile) throw new Error("--status requires --checkpoint-file");
    const checkpoint = await OrphanRepairCheckpoint.load(parsed.checkpointFile);
    console.info(JSON.stringify(checkpoint.summary(), null, 2));
    return;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI must be set before repairing an entitlement");
  }

  const actor = process.env.REPAIR_ACTOR || process.env.USERNAME || "manual-cli";

  await connectDb();
  try {
    if (parsed.resume || parsed.purchaseIds.length > 0) {
      if (!parsed.checkpointFile) {
        throw new Error("batch and resume modes require --checkpoint-file");
      }
      const summary = await runResumableOrphanRepair({
        checkpointFile: parsed.checkpointFile,
        purchaseIds: parsed.purchaseIds,
        resumeRunId: parsed.resume,
        apply: parsed.apply,
        actor,
        repair: (purchaseId, options) => repairEntitlementForPurchase(purchaseId, options),
      });
      console.info(JSON.stringify(summary, null, 2));
      if (summary.failed > 0) process.exitCode = 1;
      return;
    }

    if (!parsed.purchaseId) throw new Error("--purchase-id is required");
    const result = await repairEntitlementForPurchase(parsed.purchaseId, {
      apply: parsed.apply,
      actor,
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
