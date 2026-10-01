# Background jobs — settlement, entitlement, analytics, exports, dispute cleanup

A durable background job system with retry, exponential backoff, and dead-letter handling. Keep request handlers fast; enqueue work instead of doing it inline.

## Architecture

- **Abstraction:** `server/src/jobs/jobQueue.ts` — `enqueueJob`, `claimNextJob`, `markJobCompleted`/`markJobFailed`, `computeBackoffDelayMs`, idempotency via `dedupeKey`, dead-letter via `dead_letter` status.
- **Persistence:** `JobRecord` Mongo collection (`server/src/models/JobRecord.ts`). Payloads are small and versioned (`payload.version`), max 4KB.
- **Worker:** `server/src/jobs/worker.ts` — `startWorker({ pollIntervalMs })` and `processOne(workerId)` for deterministic testing. Handlers in `server/src/jobs/handlers/*`.
- **Observability:** `GET /api/jobs`, `GET /api/jobs/dead-letter`, `GET /api/jobs/:id`, `POST /api/jobs/:id/requeue` (admin).

## Job types

| Type | Payload (v1) | Purpose |
|------|--------------|---------|
| `settlement_poll` | `{version, purchaseId, promptId, buyerWallet, txHash?}` | Poll Horizon/RPC for settlement confirmation after `buy_prompt` |
| `entitlement_repair` | `{version, promptId, buyerWallet}` | Re-verify `has_access` on-chain and repair indexer lag |
| `analytics_aggregate` | `{version, windowDays, creatorWallet?}` | Recompute daily sales / preview aggregates |
| `export_csv` | `{version, creatorWallet, startDate?, endDate?, requestedBy}` | Generate payout statement CSV (request handler only enqueues) |
| `stale_dispute_cleanup` | `{version, olderThanDays, dryRun?}` | **Migrated task** — closes `disputed` purchases older than cutoff; replaces ad-hoc inline cleanup |
| `retention_cleanup` | `{version, dryRun?}` | Archives expired operational events, export job metadata, and closed support evidence; honors retention holds |

## Retry, backoff, dead-letter

- `maxAttempts` default 5 (override per `enqueueJob` options).
- On failure, `markJobFailed` computes `delay = baseDelay * 2^(attempt-1)` (base 1000ms, deterministic, no random jitter so tests stay stable). The job goes back to `pending` with `nextRunAt = now + delay` and `attemptHistory` appended.
- After `maxAttempts`, status becomes `dead_letter` instead of silently disappearing. Operators inspect via `GET /api/jobs/dead-letter` and requeue with `POST /api/jobs/:id/requeue`.
- All failures are observable via `lastError`, `attempts`, `nextRunAt`, and the `GET /api/jobs` listing.

## Idempotency

- Every enqueue computes `dedupeKey = type:sha(payload)` by default. If a `pending`/`processing` job with the same key was created within `dedupeWindowMs` (default 60s), the existing job is returned instead of duplicating.
- Handlers themselves are idempotent: `settlement_poll` no-ops if Purchase already `purchased` with `txHash`; `entitlement_repair` no-ops if no Entitlement doc; `analytics_aggregate` recomputes from source; `stale_dispute_cleanup` only touches stale `disputed` rows.
- `retention_cleanup` rechecks each record's status, age, archive marker, and hold before archiving. It scrubs retained operational payloads instead of deleting the records. Audit, blockchain, purchase, and financial records are never selected.

## Migrated task

`stale_dispute_cleanup` was previously inline / ad-hoc (check `Purchase.status === "disputed"` scattered). It now enqueues as:

```ts
import { enqueueJob } from "./jobs/jobQueue";
await enqueueJob("stale_dispute_cleanup", { version: 1, olderThanDays: 14 }, { dedupeKey: "cleanup:daily" });
```

The worker runs it on schedule (`setInterval` or external cron hitting the enqueue endpoint).

## Retention cleanup

Apply migration `005_data_retention_controls` before scheduling retention
cleanup; it removes an existing TTL index that would otherwise delete webhook
records without checking holds. First enqueue a dry run with
`cd server && npm run retention:enqueue -- --dry-run` and inspect the worker's
per-collection counts. Then schedule `cd server && npm run retention:enqueue`
once per day through the environment's scheduler. The command uses a stable
dedupe key and requires `MONGODB_URI`; the worker must be running separately.
The retention policy, hold procedure, and protected collections are documented in
[data-retention-and-privacy.md](./data-retention-and-privacy.md).

## Local worker setup

```bash
cd server
yarn install
# Requires MONGODB_URI (and optional REDIS_URL for other services)
MONGODB_URI=mongodb://localhost:27017/prompthash \
WORKER_POLL_INTERVAL_MS=2000 \
yarn worker   # defined as: ts-node src/jobs/index.ts  (add script if missing)

# Or run with build:
yarn build && node build/jobs/index.js
```

In development, the API server (`yarn dev` in `server/`) does not auto-start the worker; run it in a separate terminal so long jobs do not block requests.

Docker: add a `worker` service in `docker-compose.yml` that runs the same image with `command: yarn worker` and shares `MONGODB_URI`.

## Enqueue from request handlers (keep them fast)

```ts
// Fast path — do not do long-running work in the handler
import { enqueueJob } from "../jobs/jobQueue";

// After a buy_prompt submission:
await enqueueJob("settlement_poll", {
  version: 1,
  purchaseId: purchase._id.toString(),
  promptId: String(promptId),
  buyerWallet: buyer.toLowerCase(),
  txHash,
});

// Export: return jobId immediately, let worker produce the file
const job = await enqueueJob("export_csv", {
  version: 1,
  creatorWallet,
  startDate, endDate,
  requestedBy: walletAddress,
});
res.json({ jobId: job.id, status: job.status });
```

## Validation steps

1. `cd server && npm test -- jobQueue` — covers retry limits, backoff, dead-letter, idempotency.
2. `GET /api/jobs?status=pending` after enqueueing a `stale_dispute_cleanup` job — job appears.
3. Force a handler failure (e.g., enqueue `settlement_poll` without `txHash`) and observe `attempts` increment, `nextRunAt` delayed, and after 5 failures `status=dead_letter`.
4. `GET /api/jobs/dead-letter` shows failed jobs; `POST /api/jobs/:id/requeue` resets to `pending`.

## Keeping payloads small and versioned

- Always include `version: 1` and only the minimal IDs needed; never include large blobs or full prompt content.
- When adding a field, bump `version` to 2 and handle both in the handler (`if (payload.version === 1) ...`).
- The queue rejects payloads larger than 4KB with a clear error so request handlers fail fast.
