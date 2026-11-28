# Dry-run repair tooling with checkpoints (#1129)

Use this tool to reconcile purchases with buyer entitlements across many records
at once. Each purchase should grant `active`. A refunded purchase should end
`refunded`. The single-purchase repair (`npm run repair:entitlement`) still exists
for one-off fixes. Use this tool for batches.

The tool is `server/scripts/repairTool.ts`. It runs the same backfill engine as
the other operator jobs (`docs/operations/stellar-wave-integrity-hardening.md`),
so it inherits its dry-run default, per-batch checkpoints, and per-record failure
isolation.

## Running it

```bash
# 1. Dry run (the default). Reads only. Prints every planned change.
MONGODB_URI=... TS_NODE_TRANSPILE_ONLY=1 \
  npm --prefix server run repair:tool -- --job entitlement-repair

# 2. Write, as an allowlisted operator.
MONGODB_URI=... REPAIR_OPERATORS=ops-alice,ops-bob TS_NODE_TRANSPILE_ONLY=1 \
  npm --prefix server run repair:tool -- --job entitlement-repair \
  --confirm --actor ops-alice
```

| Option | Meaning |
| --- | --- |
| `--job entitlement-repair` | Required. The only job today. |
| `--confirm` | Write changes. Without it the run is a dry run. |
| `--actor <id>` | Required with `--confirm`. Recorded on every audit entry. |
| `--batch-size <n>` | Purchases per page (default 100). Also the checkpoint granularity. |
| `--max <n>` | Stop after scanning `n` purchases. Use it to stage a large repair. |
| `--checkpoint <file>` | Default `repair-checkpoints/entitlement-repair.json`. |
| `--restart` | Ignore the checkpoint and start from the first purchase. |

`TS_NODE_TRANSPILE_ONLY=1` is required in this repo. `ts-node` does not pick up
the server's Node type definitions for `scripts/`, so without it the tool fails
to compile. The same failure affects `backfillTool.ts`.

Exit codes: `0` clean run. `1` at least one record failed, or the run threw. `2`
bad arguments or a refused write. A refused write exits before any database
connection is opened.

## Authorization

A write needs all three of the following, and the check runs before any database
connection is opened:

1. `--confirm`.
2. `--actor <id>`.
3. The actor is listed in `REPAIR_OPERATORS`, a comma-separated environment
   variable. If it is empty or unset, every write is refused.

Dry runs need none of these. Anyone who can read the database can run one.

Each write records an `entitlement_repair` audit entry. The entry names the
operator, the purchase, and the `beforeState` and `afterState` entitlement
statuses. The entry is written with `throwOnError`, so a write whose audit record
fails is reported as a failure rather than completed silently.

## What a run does

For each purchase, in `_id` order:

| Purchase | Current entitlement | Result |
| --- | --- | --- |
| Paid | none | grant `active` |
| Paid | `revoked` / `refunded` / `expired` | grant `active` (grant reactivates the row) |
| Refunded | `active` | revoke to `refunded` |
| Refunded | none | skip: nothing to revoke |
| Any | already matches | skip |
| Missing buyer wallet or prompt ID | any | recorded failure; the run continues |

Dry-run output lists every planned change under `diffs`, with a `before` and
`after` for each field. `diffsTruncated` is true when more than 200 changes exist.
The counts stay exact.

## Checkpoints and resume

- Progress is saved after each batch to the checkpoint file. The file is written
  to a temporary path and then renamed, so a crash cannot leave a half-written
  checkpoint.
- A dry run never writes the checkpoint. It does read it and resume from its cursor, so after an interrupted write run a dry run shows only the records still to do. Pass `--restart` to plan from the first purchase.
- A rerun without `--restart` resumes after the last saved batch.
- A checkpoint belongs to one job. Pointing another job at it is refused.
- A completed run leaves `complete: true`. Rerunning it plans nothing new.

### Edge case: failures are not retried on resume

A checkpoint advances after every batch, including batches with failures. Failed
records are listed in the report, but they are not replayed by an ordinary resume.
To retry them, rerun with `--restart`. Because the job is idempotent, records that
are already correct are skipped.

Keep the report (`stdout`) of every write run. It is the only list of failed
records.

## Recovery and rollback

The tool does not roll itself back. Three ways to recover:

1. **A run stopped partway.** Rerun the same command. It resumes from the
   checkpoint. Nothing is applied twice, because records that already match are
   skipped.
2. **A record failed.** Fix its cause (for example, a purchase missing a wallet),
   then run with `--restart`. Only records that still differ are written.
3. **A write was wrong.** Find the `entitlement_repair` audit entries for the
   run, filtered by `actor` and `reason: batch_entitlement_repair`. Each one holds
   `beforeState.entitlementStatus`. Restore that status by hand, or with the
   single-purchase repair after correcting the purchase. Do not delete audit
   entries.

To discard a bad checkpoint and start over, delete the checkpoint file, or run
with `--restart`. Neither changes entitlements.

## Contracts and migration

- No schema change and no migration. The repair reads `purchases` and
  `entitlements`, and writes through the existing `grantEntitlement`,
  `revokeEntitlement` and audit functions.
- `npm run repair:entitlement` and its behaviour are unchanged.
- The pagination cursor compares `_id` as an `ObjectId`. A string comparison would
  silently skip records.

## Verification

```bash
cd server
npx vitest run src/tests/entitlementRepairJob.test.ts \
  src/tests/entitlementRepairAdapter.test.ts \
  src/tests/backfillEngine.test.ts
```

- `entitlementRepairJob.test.ts`: dry run, apply, idempotent re-run, refund
  mapping, malformed purchase, write failure, retry with `--restart`, resume from
  checkpoint, checkpoint from another job, and the authorization rules.
- `entitlementRepairAdapter.test.ts`: the Mongo adapter against a real mongod.
  Covers `ObjectId` paging across single-record batches, real grant and revoke
  writes, and audit entries with the operator recorded.
