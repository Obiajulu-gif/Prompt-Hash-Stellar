/**
 * Operator repair tool with dry-run and checkpoints (#1129).
 *
 * Usage:
 *   ts-node scripts/repairTool.ts --job entitlement-repair [options]
 *
 * Options:
 *   --job <name>          Required. Currently: entitlement-repair.
 *   --confirm             Write changes. Without it the tool is a dry run.
 *   --actor <id>          Required with --confirm. Must be on REPAIR_OPERATORS.
 *   --batch-size <n>      Purchases per page (default 100).
 *   --max <n>             Stop after scanning n purchases in this run.
 *   --checkpoint <file>   Checkpoint file (default repair-checkpoints/<job>.json).
 *   --restart             Ignore the existing checkpoint and start from the first purchase.
 *
 * Environment:
 *   MONGODB_URI           MongoDB connection string.
 *   REPAIR_OPERATORS      Comma-separated operator ids allowed to pass --confirm.
 *
 * Exit codes: 0 clean run, 1 at least one record failed or the run threw,
 * 2 bad arguments or a refused write. A dry run never writes entitlements,
 * audit records, or the checkpoint. Runbook: docs/operations/dry-run-repair-tooling.md.
 */

import path from "path";
import mongoose from "mongoose";
import { fileCheckpointStore, runBackfill } from "../src/services/backfillEngine";
import {
  ENTITLEMENT_REPAIR_JOB,
  authorizeRepairWrite,
  entitlementRepairJob,
} from "../src/services/entitlementRepairJob";
import { mongoEntitlementRepairPort } from "../src/services/entitlementRepairAdapter";

const JOBS = new Set([ENTITLEMENT_REPAIR_JOB]);

const args = process.argv.slice(2);
const hasFlag = (name: string) => args.includes(`--${name}`);
const readOption = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : undefined;
};

class UsageError extends Error {}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new UsageError(`--${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

async function main(): Promise<number> {
  const jobName = readOption("job");
  if (!jobName || !JOBS.has(jobName)) {
    throw new UsageError(`--job is required. Available jobs: ${[...JOBS].join(", ")}`);
  }

  const batchSize = parsePositiveInt(readOption("batch-size"), 100, "batch-size");
  const maxRaw = readOption("max");
  const maxRecords = maxRaw === undefined ? undefined : parsePositiveInt(maxRaw, 0, "max");
  const dryRun = !hasFlag("confirm");
  const actor = readOption("actor");

  if (!dryRun) {
    // Authorization happens before any database connection.
    const allowlist = (process.env.REPAIR_OPERATORS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const refusal = authorizeRepairWrite(actor, allowlist);
    if (refusal) throw new UsageError(refusal);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new UsageError("MONGODB_URI is required");

  const checkpointPath =
    readOption("checkpoint") ??
    path.resolve(process.cwd(), "repair-checkpoints", `${jobName}.json`);

  console.error(
    dryRun
      ? `[repair] dry run for "${jobName}". Pass --confirm --actor <id> to write.`
      : `[repair] WRITING changes for "${jobName}" as ${actor}. Checkpoint: ${checkpointPath}`,
  );

  await mongoose.connect(uri);
  try {
    const job = entitlementRepairJob(mongoEntitlementRepairPort(), actor ?? "dry-run");
    const report = await runBackfill(job, fileCheckpointStore(checkpointPath), {
      dryRun,
      batchSize,
      maxRecords,
      restart: hasFlag("restart"),
    });
    console.log(JSON.stringify(report, null, 2));
    return report.failed > 0 ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (err instanceof UsageError) {
      console.error(`[repair] ${err.message}`);
      process.exitCode = 2;
      return;
    }
    console.error("[repair] run failed:", err);
    process.exitCode = 1;
  });
