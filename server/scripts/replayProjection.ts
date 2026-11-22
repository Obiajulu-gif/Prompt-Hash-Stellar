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
 *
 * Environment:
 *   MONGODB_URI                     – MongoDB connection string
 *   PUBLIC_STELLAR_RPC_URL          – Soroban RPC (backfill only)
 *   PUBLIC_PROMPT_HASH_CONTRACT_ID  – contract to backfill (backfill only)
 *   REPLAY_OPERATOR                 – recorded as the actor (default: $USER)
 *
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
} from "../src/services/projectionReplay";

const [command, target, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(name) || target === name;
const option = (name: string) => {
  const all = [target, ...rest];
  const index = all.indexOf(name);
  return index === -1 ? undefined : all[index + 1];
};
const operator = process.env.REPLAY_OPERATOR || process.env.USER || "cli";

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
        const run = await startReplay({
          projection: target,
          mode: flag("--dry-run") ? "dry_run" : "build",
          strict: !flag("--lenient"),
          startedBy: operator,
        });
        console.log(`Started run ${run.runId} (${run.projection}@v${run.projectionVersion}, ${run.mode})`);
        console.log(JSON.stringify(await runReplay(run.runId, { batchSize: Number(option("--batch")) || undefined }), null, 2));
        break;
      }
      case "resume":
        console.log(JSON.stringify(await runReplay(target), null, 2));
        break;
      case "activate":
        console.log(JSON.stringify(await activateRun(target, operator), null, 2));
        break;
      case "rollback":
        console.log(JSON.stringify(await rollbackProjection(target, operator), null, 2));
        break;
      case "prune":
        console.log(`Deleted ${await pruneInactiveRuns(target)} rows from inactive runs.`);
        break;
      default:
        console.error("Commands: list | backfill | replay | resume | activate | rollback | prune");
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
