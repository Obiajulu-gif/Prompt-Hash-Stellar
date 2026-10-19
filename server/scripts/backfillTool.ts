/**
 * Operator backfill tool (#966).
 *
 * Usage:
 *   ts-node scripts/backfillTool.ts --job <name> [options]
 *
 * Options:
 *   --job <name>          Required. One of the jobs listed by the tool.
 *   --confirm             Write changes. Without it the tool is a dry run.
 *   --batch-size <n>      Records per page (default 100).
 *   --max <n>             Stop after scanning n records in this run.
 *   --checkpoint <file>   Checkpoint file (default backfill-checkpoints/<job>.json).
 *   --restart             Ignore the existing checkpoint and start from the first record.
 *
 * Environment:
 *   MONGODB_URI           MongoDB connection string.
 *
 * Exit codes: 0 clean run, 1 at least one record failed or the run threw,
 * 2 bad arguments. A dry run never writes records or the checkpoint.
 *
 * Recovery steps are in docs/operations/stellar-wave-integrity-hardening.md.
 */

import path from "path";
import mongoose from "mongoose";
import Prompt from "../src/models/Prompt";
import {
  BackfillJob,
  fileCheckpointStore,
  runBackfill,
} from "../src/services/backfillEngine";
import { PromptCollection, promptReadFillsJob } from "../src/services/backfillJobs";

const JOBS: Record<string, () => BackfillJob> = {
  "prompt-read-fills": () => promptReadFillsJob(Prompt as unknown as PromptCollection),
};

const args = process.argv.slice(2);
const hasFlag = (name: string) => args.includes(`--${name}`);
const readOption = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : undefined;
};

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new UsageError(`--${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

class UsageError extends Error {}

async function main(): Promise<number> {
  const jobName = readOption("job");
  if (!jobName || !JOBS[jobName]) {
    throw new UsageError(
      `--job is required. Available jobs: ${Object.keys(JOBS).join(", ")}`,
    );
  }

  const batchSize = parsePositiveInt(readOption("batch-size"), 100, "batch-size");
  const maxRecordsRaw = readOption("max");
  const maxRecords = maxRecordsRaw === undefined ? undefined : parsePositiveInt(maxRecordsRaw, 0, "max");
  const dryRun = !hasFlag("confirm");
  const checkpointPath =
    readOption("checkpoint") ??
    path.resolve(process.cwd(), "backfill-checkpoints", `${jobName}.json`);

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new UsageError("MONGODB_URI is required");

  console.error(
    dryRun
      ? `[backfill] dry run for "${jobName}". Pass --confirm to write changes.`
      : `[backfill] WRITING changes for "${jobName}". Checkpoint: ${checkpointPath}`,
  );

  await mongoose.connect(uri);
  try {
    const report = await runBackfill(JOBS[jobName](), fileCheckpointStore(checkpointPath), {
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
      console.error(`[backfill] ${err.message}`);
      process.exitCode = 2;
      return;
    }
    console.error("[backfill] run failed:", err);
    process.exitCode = 1;
  });
