# Integrity hardening: canonical payloads, audit ledger, backfill, chaos tests

This runbook covers four changes that harden how PromptHash Stellar records,
signs, and repairs data: #979 (canonical serialization), #982 (audit ledger),
#966 (backfill tool), and #964 (chaos suite). Read the section for the change
you are operating. The **Known gaps** section at the end lists related problems
that were found but not fixed here.

---

## 1. Canonical serialization for signed and hashed payloads (#979)

### What changed

Three places computed their own key-sorted JSON before hashing: the webhook
outbox payload hash, the idempotency request digest, and the audit record hash.
They now all use `canonicalJson` in `server/src/services/canonicalSerialization.ts`.

Rules:

- object keys are sorted recursively, so insertion order never changes the bytes;
- `undefined` members are dropped, the same as an absent key;
- `Date` values become ISO-8601 strings;
- strings and numbers are not normalized, so output matches `JSON.stringify`.

### Compatibility

For JSON-compatible input the output is byte-identical to the previous
serializers. `canonicalJson.test.ts` compares against verbatim copies of the
old code, so digests already in the database still verify.

Two intentional differences:

- **Date values in webhook payloads.** The old outbox serializer turned a `Date`
  into `{}`. The new one emits its ISO string. Payloads are normally plain JSON,
  so this only affects a `Date` that reached the outbox. Subscribers verify the
  body signature, not `payloadHash`, so no delivery verification breaks.
- **Undefined idempotency bodies** keep the historical `"undefined"` token, so
  keys in flight across a deploy still replay.

### Rollback

Reverting the commit is safe. No data migration was run, and the outputs are
identical for JSON input.

---

## 2. Tamper-evident audit ledger (#982)

### What changed

- **Serialized appends.** `recordAuditEvent` runs chain appends one at a time
  inside a process. This stops two concurrent calls from reading the same head
  and forking the chain.
- **Unique previousHash index.** `AuditLog` has a partial unique index on
  `previousHash`, limited to string values. A fork across replicas now fails with
  E11000 at the database. The append re-reads the head and retries, up to three
  attempts.
- **Maintenance banner events are persisted.** `maintenanceBannerService` used to
  write `AuditLog` directly. Those writes skipped the hash chain, and their action
  names were not in the schema enum, so Mongoose dropped them and the catch block
  logged the failure. They now go through `recordMaintenanceChange`, and
  `admin_maintenance_change` is a registered action.
- **Metadata is covered by the hash.** Integrity version 3 includes `metadata`.
  Version 2 records keep their original digests and still verify.

### Deploy checklist

1. Before deploying, check for forks that would block the unique index. Forks
   are records that share a `previousHash`:

   ```js
   db.auditlogs.aggregate([
     { $match: { previousHash: { $type: "string" } } },
     { $group: { _id: "$previousHash", n: { $sum: 1 } } },
     { $match: { n: { $gt: 1 } } },
   ]);
   ```

   An empty result means the index will build. Mongoose attempts the build on
   startup, so check the startup logs for an index error whenever you deploy.

2. If the query returns rows, **stop**. Do not edit or delete audit rows, since
   they are append-only by design. Export the affected range first with
   `exportAuditBundle`, then escalate. The index can be created later, once the
   forks have been explained.

3. After deploy, run `verifyAuditTrail()` from a maintainer shell and confirm
   `valid: true`.

### Failure modes

| Symptom | Cause | What to do |
| --- | --- | --- |
| `audit: failed to persist audit event to DB` with `code 11000` after 3 attempts | Replicas keep reading a stale head, usually because clocks are skewed (the head is chosen by `createdAt`) | Check NTP on every replica. The event is not chained and is lost, so check the logs for these lines and reconstruct the event from the request log if needed. |
| `verifyAuditTrail` reports `hash mismatch` on v3 rows | Someone changed a row, or the verifier is older than the writer | Confirm the verifier is on this version. If it is, treat the row as tampered and escalate. |
| `verifyAuditTrail` reports `previous hash mismatch` | A row was removed or a fork exists | Locate the gap with the query above and escalate. Do not patch the chain. |
| Banner changes from before this release are missing from the trail | They were never persisted (see above) | Nothing to recover. They are gone. Document the window in the incident log. |

### Rollback

**Do not roll back to the previous verifier without a plan.** Rows written at
integrity version 3 include metadata in their digest. An older verifier does not
include it, so it reports those rows as tampered. If you must roll back the code:

1. export the audit bundle for the v3 period first, and
2. record that the reported mismatches are expected.

The unique index is harmless to the old code and can stay. It can be dropped
with `db.auditlogs.dropIndex("previousHash_1")` if needed.

---

## 3. Operator backfill tool (#966)

### Commands

Run from `server/`:

```bash
# Dry run (default). Prints every planned diff. Writes nothing.
npm run backfill -- --job prompt-read-fills

# Stage a large run: scan at most 1000 records, then stop.
npm run backfill -- --job prompt-read-fills --max 1000

# Write the changes. Only --confirm writes.
npm run backfill -- --job prompt-read-fills --confirm
```

Options: `--batch-size <n>` (default 100), `--checkpoint <file>`,
`--restart`. `MONGODB_URI` must be set.

### Behavior

- **Dry run is the default.** It reports `planned`, `diffs`, and `failures`. It
  keeps up to 200 diffs and sets `diffsTruncated` when there are more. It never
  writes records or the checkpoint.
- **Checkpoints.** After each batch the cursor is written to
  `server/backfill-checkpoints/<job>.json`. The write is atomic (temp file, then
  rename). The directory is gitignored.
- **Resume.** Run the same command again. The run continues from the last
  checkpoint. A checkpoint from a different job is refused unless you pass
  `--restart`.
- **Failures.** A bad record is logged and skipped. The run continues. The exit
  code is `1` when any record failed, so a scheduler can alert on it.

### Recovery steps

| Situation | Action |
| --- | --- |
| Process crashed | Rerun the same command. It resumes from the last checkpoint. A batch that was written but not checkpointed is scanned again, and the plan skips it. |
| Checkpoint file is unreadable or corrupt | Move it aside and rerun with `--restart`. Re-scanning is safe because the plan is idempotent. |
| Failures in the report | Fix the data for those ids, then rerun with `--restart`. The records that already match the target are skipped, so the rerun is quick. |
| Checkpoint directory is missing or not writable | The run aborts before writing that batch. Fix the path or permissions and rerun. |
| Ran with `--confirm` by mistake | The `prompt-read-fills` changes persist the fields the read path already computes, so reads return the same result before and after. To undo, restore from backup (see `backup-and-recovery.md`). |

### Job: `prompt-read-fills`

Targets prompts whose `schemaVersion` is missing or below the current version.
It persists the fields the read-path transform fills (`schemaVersion`,
`lifecycleState`, `moderationStatus`, `tags`, `description`, `licence`,
`category`, `listingStatus`) only where the stored value differs from what reads
already return. Prompts from a newer build are reported as failures and are not
rewritten.

### Writing a new job

A job implements `fetchPage`, `plan`, and `apply` in
`server/src/services/backfillEngine.ts`. Two rules:

- `plan` depends only on the record's current state, performs no I/O, and
  returns `skip` once the record matches the target. This is what makes replay
  safe after a crash.
- `apply` writes exactly the `changes` it was given.

---

## 4. Deterministic chaos suite (#964)

`server/src/tests/chaosWorkflows.test.ts` covers four interrupted workflows:

1. webhook delivery with dropped requests, lost acknowledgements, and replays
   outside the signature window;
2. idempotent payment across a restart after a lost response;
3. the audit chain during a transient storage failure;
4. a backfill that crashes at seeded checkpoint writes and restarts until it
   completes.

Fault schedules live in `server/src/tests/helpers/faultInjector.ts`. Scripted
and seeded schedules are deterministic, and the suite does not use timers, the
real network, or `Math.random`.

When adding a scenario, use the helpers rather than ad hoc `throw`s, so the
injected failure can be told apart from a real bug. The suite checks invariants
under interruption. It is not a load test.

---

## Known gaps (found, not fixed here)

- **Decision-history chain has the same race.** `changeHistory.ts` appends
  per-entity with no serialization or unique index on `previousHash`. Apply the
  same queue and index pattern used in #982.
- **Job dedupe key is not canonical.** `jobQueue.ts` hashes `JSON.stringify(payload)`
  without sorting keys. Changing it would change keys for jobs already queued, so
  it needs a migration plan.
- **ETag hashing** (`middleware/etag.ts`) uses SHA-1 over unsorted JSON. It is a
  cache validator, not a signature, so it was left alone.
- **Clock dependence.** The audit head is chosen by `createdAt`. Replicas with
  skewed clocks can exhaust append retries. A sequence number per chain would
  remove that dependence.
