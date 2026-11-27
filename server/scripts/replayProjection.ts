
/**
 * Versioned projection replay CLI (#1024).
 *
 * Usage:
 *   ts-node scripts/replayProjection.ts list
 *   ts-node scripts/replayProjection.ts backfill --from <ledger> [--to <ledger>]
 *   ts-node scripts/replayProjection.ts replay <projection> [--dry-run] [--lenient] [--batch <n>]
 *   ts-node scripts/replayProjection.ts resume <runId>
 *   ts-node scripts/replayProjection.ts activate <runId>
 *   ts-node scripts/replayProjection.ts rollback <projection>
 *   ts-node scripts/replayProjection.ts prune <projection>
 *   ts-node scripts/replayProjection.ts status <runId>
 *
 * Environment:
 *   MONGODB_URI                     – MongoDB connection string
 *   PUBLIC_STELLAR_RPC_URL          – Soroban RPC (backfill only)
 *   PUBLIC_PROMPT_HASH_CONTRACT_ID  – contract to backfill (backfill only)
 *   REPLAY_OPERATOR                 – recorded as the actor (default: $USER)
 *
 * Exit codes: 0 success, 1 usage/runtime error, 2 replay completed with failures.
 * `replay` never touches the served projection; `activate` switches to the
 * new copy and `rollback` switches back. See docs/operations/event-replay.md.
 */

import mongoose from "mongoose";
import { rpc as StellarRpc, scValToNative } from "@stellar/stellar-sdk";
import { decodeEvent } from "@prompthash/sdk";
import { appendToJournal } from "../src/services/eventJournal";
import {
  activateRun,
  listProjections,
  pruneInactiveRuns,
  rollbackProjection,
  runReplay,
  startReplay,
  getRunStatus,
} from "../src/services/projectionReplay";

const [command, target, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(name) || target === name;
const option = (name: string) => {
  const all = [target, ...rest];
  const index = all.indexOf(name);
  return index === -1 ? undefined : all[index + 1];
};
const operator = process.env.REPLAY_OPERATOR || process.env.USER || "cli";

function requireTarget(value: string | undefined, command: string): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${command} requires a target argument`);
  }
  return value;
}

function parseBatchSize(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--batch must be a positive integer, got: ${raw}`);
  return n;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function backfill() {
  const from = Number(option("--from"));
  if (!Number.isInteger(from) || from < 1) throw new Error("backfill requires --from <ledger>");
  const rpcUrl = requireEnv("PUBLIC_STELLAR_RPC_URL");
  const contractId = requireEnv("PUBLIC_PROMPT_HASH_CONTRACT_ID");
  const server = new StellarRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  const to = Number(option("--to")) || (await server.getLatestLedger()).sequence;

  let cursor: string | undefined;
  let written = 0;
  let duplicates = 0;
  let skipped = 0;
  for (;;) {
    const page = await server.getEvents(
      cursor
        ? { cursor, filters: [{ type: "contract", contractIds: [contractId] }], limit: 200 }
        : { startLedger: from, filters: [{ type: "contract", contractIds: [contractId] }], limit: 200 },
    );
    for (const event of page.events) {
      if (event.ledger > to) {
        console.log(`Backfill done: ${written} written, ${duplicates} already journaled, ${skipped} unrecognized`);
        return;
      }
      const decoded = decodeEvent(String(scValToNative(event.topic[0])), scValToNative(event.value));
      if (!decoded.recognized) {
        skipped += 1;
        continue;
      }
      // appendToJournal is idempotent on eventId; retries are safe.
      const isNew = await appendToJournal({
        eventId: event.id,
        ledger: event.ledger,
        txHash: event.txHash,
        contractId: String(event.contractId ?? contractId),
        eventType: decoded.type,
        eventVersion: decoded.version,
        payload: decoded.data,
        source: "backfill",
      });
      if (isNew) written += 1;
      else duplicates += 1;
    }
    if (page.events.length === 0 || !page.cursor || page.cursor === cursor) break;
    cursor = page.cursor;
  }
  console.log(`Backfill done: ${written} written, ${duplicates} already journaled, ${skipped} unrecognized`);
}

async function main() {
  await mongoose.connect(requireEnv("MONGODB_URI"));
  try {
    switch (command) {
      case "list":
        console.table(listProjections().map(({ name, version, description }) => ({ name, version, description })));
        break;
      case "backfill":
        await backfill();
        break;
      case "replay": {
        const projection = requireTarget(target, "replay");
        const batchSize = parseBatchSize(option("--batch"));
        const run = await startReplay({
          projection,
          mode: flag("--dry-run") ? "dry_run" : "build",
          strict: !flag("--lenient"),
          startedBy: operator,
        });
        console.log(`Started run ${run.runId} (${run.projection}@v${run.projectionVersion}, ${run.mode})`);
        const result = await runReplay(run.runId, { batchSize });
        console.log(JSON.stringify(result, null, 2));
        if (result && typeof result === "object" && "failed" in result && Number((result as { failed?: number }).failed) > 0) {
          process.exitCode = 2;
        }
        break;
      }
      case "resume":
        console.log(JSON.stringify(await runReplay(requireTarget(target, "resume")), null, 2));
        break;
      case "activate":
        console.log(JSON.stringify(await activateRun(requireTarget(target, "activate"), operator), null, 2));
        break;
      case "rollback":
        console.log(JSON.stringify(await rollbackProjection(requireTarget(target, "rollback"), operator), null, 2));
        break;
      case "prune":
        console.log(`Deleted ${await pruneInactiveRuns(requireTarget(target, "prune"))} rows from inactive runs.`);
        break;
      case "status":
        console.log(JSON.stringify(await getRunStatus(requireTarget(target, "status")), null, 2));
        break;
      default:
        console.error("Commands: list | backfill | replay | resume | activate | rollback | prune | status");
        process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Replay error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

