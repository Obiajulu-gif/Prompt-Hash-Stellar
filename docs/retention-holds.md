# Granular Retention Holds for Disputes and Investigations

Records linked to an active dispute, investigation or legal matter are
protected from the `retention_cleanup` job until the hold is released.

Code: `server/src/models/RetentionHold.ts` (ledger),
`server/src/services/retentionHoldService.ts` (place / release / reconcile),
`server/src/routes/retentionHoldRoutes.ts` (admin API),
`server/src/jobs/handlers/retentionCleanup.ts` (enforcement).
Tests: `server/src/tests/retentionHoldService.test.ts`,
`server/src/tests/retentionCleanup.test.ts`.

## Model

A **hold** = one case + the specific records it protects.

| Field         | Meaning                                                              |
| ------------- | -------------------------------------------------------------------- |
| `caseType`    | `dispute` \| `investigation` \| `legal`                              |
| `caseRef`     | Your case/ticket/dispute id (max 200 chars)                          |
| `reason`      | 10–500 chars: why preservation is needed                             |
| `links`       | `[{ collection, recordId }]`, at most 500                            |
| `reviewBy`    | Date the hold must be re-examined (default 90 days, max 365)         |
| `status`      | `active` \| `released`; release records actor, time and reason       |
| `alreadyArchived` | Linked records cleanup had already scrubbed before the hold       |

**Eligible linked records** are exactly the collections cleanup can archive:

| `collection`           | Model                | Notes                                   |
| ---------------------- | -------------------- | --------------------------------------- |
| `inboundWebhookEvents` | `InboundWebhookEvent`| 30-day policy                           |
| `quarantinedEvents`    | `QuarantinedEvent`   | 30-day policy                           |
| `exports`              | `JobRecord` (export) | 30-day policy                           |
| `supportEvidence`      | `Report`             | 365-day policy; `includePromptReportsFor` links every report on a prompt |

`AuditLog`, `LedgerEntry`, `Purchase`, `PayoutStatement` and `ProcessedEvent`
are never archived, so they cannot be held (requests naming them are
rejected).

Several holds may cover the same record. The record returns to normal
retention only when the **last** active hold covering it is released.

## How cleanup skips held records

1. At the start of each run, cleanup reads all active holds
   (`getActiveHeldRecordIds`) and adds `_id: { $nin: heldIds }` to the
   eligibility count, the candidate lookup and the archive update.
2. Each held record also carries `retentionHold: true`
   (`retentionHoldReason: "retention-hold-ledger"`). The archive update still
   re-checks `retentionHold: { $ne: true }`, so a hold placed while a batch is
   running wins.
3. `held` in the cleanup summary counts flag-held **and** ledger-held records
   (ledger-held records whose flag is missing are still counted and skipped).
4. **Fail closed:** if the ledger cannot be read the run throws, nothing is
   archived, and the worker retries.

Ordering on place: flags → ledger document → flags re-asserted. On release:
ledger marked released → flags cleared only for records no other active hold
covers. Flags with any reason other than the ledger marker (an operator's
manual `retentionHold`) are never overwritten or cleared by a release.

## API (admin token scopes `retention-holds:read` / `retention-holds:write`)

```
POST /api/admin/retention-holds
  { "caseType": "dispute", "caseRef": "DSP-1042",
    "reason": "Buyer dispute open; preserve webhook and report evidence",
    "links": [{ "collection": "supportEvidence", "recordId": "<24-hex>" }],
    "includePromptReportsFor": "<promptId, optional>", "reviewDays": 60 }
POST /api/admin/retention-holds/:id/release   { "reason": "Dispute resolved, no legal request" }
GET  /api/admin/retention-holds?status=active&caseRef=DSP-1042
GET  /api/admin/retention-holds/overdue        # active holds past reviewBy
POST /api/admin/retention-holds/reconcile      { "dryRun": true }
```

`POST` returns `201` for a new hold and `200` if an identical active hold
(same case and records) already existed, so client retries are safe. Errors:
`400 invalid_request`, `404 record_not_found | hold_not_found`,
`409 already_released`, `503 ledger_unavailable`.

## Audit

Every action is written to the tamper-evident audit trail:
`retention_hold_created`, `retention_hold_released` (result `failure` if flags
could not be cleared) and `retention_hold_reconciled`, with actor, case,
record counts and the justification text. Export with
`GET /api/audit/export?action=retention_hold_created,retention_hold_released`.

## Operating procedure

1. **Place** a hold as soon as a dispute/investigation is opened, *before* the
   next scheduled cleanup. Check the response `alreadyArchived`: those records
   were scrubbed earlier and cannot be restored except from backup.
2. **Review** weekly: `GET .../overdue`. Release or consciously extend
   (release and re-place) holds past `reviewBy`; forgotten holds keep personal
   data forever.
3. **Release** only with a documented reason. Normal retention resumes at the
   next cleanup run; nothing is archived immediately.
4. After any incident, run `reconcile` with `dryRun: true` and inspect.

## Edge cases and failure modes

- **Hold on a missing record:** rejected (`record_not_found`) and nothing is
  changed; a hold must never silently protect nothing.
- **Hold on an already-archived record:** allowed (the metadata is still
  useful) but reported in `alreadyArchived`; scrubbed fields are gone.
- **Ledger write fails after flags were set:** the flags this call set are
  rolled back; the error is returned.
- **Clearing flags fails on release:** the hold is released, the record stays
  flagged (over-retained, never under-retained), the response has
  `flagsCleared: false` and the audit result is `failure`. Run
  `reconcile` (`dryRun: false`) once the database recovers.
- **Release racing a new hold on the same record:** the ledger still
  protects the record from cleanup; the new hold re-asserts the flag after
  its ledger insert.
- **Hold placed mid-run:** the archive update's flag re-check protects the
  record; at worst that batch skips it and the next run honours the ledger.
- **Manual flags** set directly on a record before this feature remain
  honoured and are not cleared by releases or `reconcile`.
- **Backups** still contain pre-scrub copies; legal holds on backups must be
  arranged with the backup provider.
- A hold limit of 500 records keeps `$nin` filters bounded. Split very large
  matters into several holds with the same `caseRef`.

## Rollback / recovery

- **Disable enforcement:** revert the cleanup handler change (or stop
  enqueueing `retention_cleanup`); per-record flags still protect everything
  held through this feature.
- **Remove a hold set in error:** release it with a reason; the audit trail
  keeps the full history.
- **Cleanup wrongly archived something held:** stop the job, place a hold on
  the remaining records, then restore the affected documents from the most
  recent backup (`docs/operations/backup-and-recovery.md`) and re-run a dry
  run before resuming.
- The `RetentionHold` collection is additive; dropping it reverts to
  flag-only protection (flags set by released/active holds remain until
  cleared manually).
