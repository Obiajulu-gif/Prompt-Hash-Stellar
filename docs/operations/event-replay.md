# Versioned event replay for rebuilding projections (#1024)

Projections (read models derived from contract events) can be rebuilt from a
durable event journal without touching the copy that is being served, checked,switched over atomically and switched back.

Code: `server/src/models/EventJournal.ts`, `server/src/services/eventJournal.ts`,
`server/src/services/projectionReplay.ts`,
`server/src/routes/projectionReplayRoutes.ts`,
`server/scripts/replayProjection.ts`.

## Pieces

- `EventJournal`: every recognized contract event, with its decoded payload and the event schema version it was decoded with. The indexer appends to it after decoding (and when a quarantined event is replayed successfully). Appends are idempotent on `eventId`, and entries cannot be updated. `ProcessedEvent` only stores ids, which is why a journal was needed.
- Projection definitions: pure reducers with a projection version and the event types and versions they understand. The first one, `prompt_listing@v1`, keeps per-prompt creator, asset, price, sale status, sales count and revenue from `PromptCreated`, `PromptPurchased`, `PromptPriceUpdated` and `PromptSaleStatusUpdated` (v1 and v2).
- Runs (`ProjectionRun`): one replay of the journal into an isolated copy (`ProjectionDocument`, keyed by `runId`), with checkpoint, counters, lease and attempts.
- Pointer (`ProjectionPointer`): which completed run is served, plus the previous one for rollback. `readActiveProjectionRow(name, key)` reads through it.

## Normal flow

```bash
# HTTP (admin token with projections:write / projections:read)
POST /api/admin/projections/prompt_listing/replays   { "mode": "dry_run" }
GET  /api/admin/projections/runs/<runId>             # counts, unsupportedSamples
POST /api/admin/projections/prompt_listing/replays   { "mode": "build" }
POST /api/admin/projections/runs/<runId>/activate

# or the CLI
npm --prefix server run projections:replay -- replay prompt_listing --dry-run
npm --prefix server run projections:replay -- replay prompt_listing
nmp --prefix server run projections:replay -- activate <runId>
```

A replay reads the journal in `(ledger, eventId)` order, a page at a time (`batchSize`, default 500). Rows are written first, then the checkpoint that covers them.

## Versioning

- Projection version: bump it whenever the reducer's output changes. Runs record the version they were built with. If the reducer version changes while a run is half built, the run fails instead of mixing two reducers' rows; start a new run.
- Event schema version: each event is classified as:
  - `applied`: the projection understands this type at this version;
  - `ignored`: the projection does not use this event type;
  - `unsupported`: the projection uses the type, but not at this version.

  In **strict** mode (default) the first unsupported event stops the run (`status: failed`, error `unsupported_version: <type> v<n> at ledger <l> (<eventId>)`), checkpointed just before it. Teach the reducer the new version (add it to `supportedEvents`, and bump the projection version if its output changes), deploy, then **resume**: the run continues from that event. In **lenient** mode (`strict: false`) unsupported events are skipped, counted, and up to 20 are sampled. Such a run **cannot be activated**, so a projection that silently dropped events is never served.

## Failure, retry and authorization

- **Failure:** any error (database, reducer) marks the run `failed` with the message and releases its lease. The served projection is unaffected.
- `EventJournal`: every recognized contract event, with its decoded payload and the event schema version it was decoded with. The indexer appends to it after decoding (and when a quarantined event is replayed successfully). Appends are idempotent on `eventId`, and entries cannot be updated. `ProcessedEvent` only stores ids, which is why a journal was needed.
- **Retry/resume:** `POST /runs/<runId>/resume` or `… resume <runId>` continues from the checkpoint. Each row remembers the last event applied to it, so if a crash landed after rows were written but before the checkpoint, re-processing that page skips events those rows already include. Nothing is counted twice. Dry runs keep rows in memory and restart from the beginning on resume.
- `ProjectionDefinition`: pure reducers with a projection version and the event types and versions they understand. The first one, `prompt_listing@v1`, keeps per-prompt creator, asset, price, sale status, sales count and revenue from `PromptCreated`, `PromptPurchased`, `PromptPriceUpdated` and `PromptSaleStatusUpdated` (v1 and v2).
- **Concurrency:** a worker claims a run with a 60 s lease that is renewed every page. A second worker gets `409 run_not_claimable` while the lease is live. A run whose worker died (expired lease) can be taken over. Completed runs cannot be restarted; start a new one.
- `ProjectionPointer`: which completed run is served, plus the previous one for rollback. `readActiveProjectionRow(name, key)` reads through it.
- **Authorization:** reads need `projections:read`; starting, resuming, activating and rolling back need `projections:write`. Starts, activations and rollbacks are recorded in the audit trail (`admin_projection_replay`, `admin_projection_activate`, `admin_projection_rollback`; all in the `admin` export scope).

## Activation and rollback

- Activation requires a **completed build** run with **no unsupported events**. It moves the current run to `previousRunId`.
- `POST /api/admin/projections/<name>/rollback` (or `… rollback <name>`) swaps the active and previous runs, and is itself reversible by rolling back again.
- `Ω prune <name>`) deletes rows of runs that are neither active, previous nor still in progress.

## Migration plan

1. **Deploy.** The journal starts empty and new events are journaled as they are indexed. Existing collections (`Prompt`, `Purchase`, …) and the indexer flow are unchanged. This change also defines the indexer's `getEventDecoder`, which was referenced but never defined: before it, every event was quarantined as `decoder_error`.
2. **Backfill history** from the chain into the journal (idempotent, safe to overlap with the live indexer):
   ```bash
   PUBLIC_STALLAR_RPC_URL=… PUBLIC_PROMPT_HASH_CONTRACT_ID=… \
     npm --prefix server run projections:replay -- backfill --from <deploy ledger>
   ```
   RPC providers retain a limited window of events. For older history, use an archive RPC.
3. **Dry run, build, compare, activate.** A dry run first shows counts and any unsupported versions. Before switching consumers over, compare a sample of rows against the existing collections.
4. **Rollback of the feature:** stop reading through the pointer. The journal and run collections can stay (append-only, no effect on other code) or be dropped.

## Operational edge cases

- **Journal write failure in the indexer** never stalls indexing. It logs `event journal append failed — backfill required for this event` with the event id and ledger; backfill that range.
- **Events for a prompt without a creation event** (journal gap) produce a row with `incomplete: true` rather than failing. Backfill the gap and rebuild.
- **Ordering:** Soroban event ids are zero-padded and sort correctly within a ledger. Entries are processed in `(ledger, eventId)` order.
- **Large rebuilds:** progress is visible on the run (`checkpoint`, `counts`), and a worker can be stopped at any time and resumed later.

## Malformed rows, missing checkpoints and apply failures (#905)

Every row is checked before a reducer sees it (`parseReplayEvent`). A row with an unusable identity (`eventId`, `ledger`) cannot be checkpointed past, so it stops every mode. Other malformed rows (empty `eventType`, `eventVersion` below 1, non-object `payload`) stop strict runs and are skipped and sampled in lenient runs. A run that skipped any malformed row cannot be activated.

Each failure is recorded on the run with the event that caused it:

| Error prefix | Cause | Run state |
| --- | --- | --- |
| `malformed_event:` | Row fails the shape check | Failed at the checkpoint before the row (strict), or skipped and counted in `counts.malformed` (lenient) |
| `unsupported_version:` | Event version unknown to the reducer | Failed at the checkpoint before the row (strict) |
| `apply_failed:` | Reducer threw on an event | Failed at the checkpoint before that event; nothing after it is applied |
| `checkpoint_event_missing:` | The checkpoint event is no longer in the journal | Failed before any row is written; start a new run |

The checkpoint event is verified before a resumed run applies anything, so a journal that lost history cannot be rebuilt silently over the gap. Start a fresh build run after restoring the journal.
