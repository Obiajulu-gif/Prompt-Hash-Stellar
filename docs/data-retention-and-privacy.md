# Off-Chain Data Retention and Privacy Guide

This document outlines how PromptHash stores, retains, and secures off-chain marketplace and unlock metadata. It clarifies the boundaries between immutable on-chain data and mutable off-chain state.

## On-Chain vs. Off-Chain Responsibilities

**Permanently On-Chain:**
- Prompt hashes and content integrity proofs.
- Ownership transfers and licensing rights.
- Payment transactions (XLM) and ledger history.

**Stored Off-Chain:**
- Rich marketplace metadata (titles, descriptions, categories).
- Prompt card images and preview media.
- User profiles, reputation scores, and reviews.
- Delivery status, analytics, and diagnostic logs.

## Stored Public and Wallet-Scoped Fields

### Public Fields
- **Marketplace Listings**: Titles, descriptions, tags, and prices.
- **Creator Profiles**: Display names, bios, and public avatars.
- **Reviews**: Public ratings and feedback left by buyers.

### Wallet-Scoped (Private/Sensitive) Fields
- **Unlock Materials**: The actual unencrypted prompt content delivered upon purchase.
- **Challenge Nonces**: Temporary cryptographic tokens used for wallet authentication.
- **Purchase History**: Off-chain fulfillment status linking a specific wallet to a purchased asset.

## Retention Expectations

- **Challenges & Nonces**: Stored temporarily in memory/Redis and expire after 5 minutes. Never persisted to long-term storage.
- **Fulfillment & Unlock Records**: Retained indefinitely to allow buyers to re-download purchased materials, unless an explicit deletion request is made.
- **Payout Statements**: Generated on demand from purchase and refund events. They are recomputed, not stored, and may be regenerated for any period within the purchase history retention window (creators: see the [creator publishing guide](./creator-publishing-guide.md)).
- **Blockchain & Financial Records**: Purchases, ledger entries, payout statements, and processed on-chain event identifiers are retained indefinitely. Automated retention cleanup never changes or deletes these records.
- **Inbound Prompt Events**: Successfully processed or intentionally skipped webhook payloads are archived after 30 days by removing the raw body and headers. The event identifier and processing outcome remain for idempotency and operations. Pending, processing, failed, and held events are excluded.
- **Quarantined Prompt Events**: Raw payloads for replayed or discarded events are scrubbed after 30 days. Events still quarantined are not eligible.
- **Exports**: Terminal CSV export job records are archived and identifying payload/error details are scrubbed after 30 days. Active jobs are excluded. The current worker does not persist generated CSV files; any future export storage must define and implement its own artifact retention before it is enabled.
- **Support Evidence**: Evidence, reporter address, description, and admin notes on resolved or dismissed reports are scrubbed after 365 days. Pending or investigating cases are never eligible.
- **Audit Logs**: Retained indefinitely. They are append-only and hash-chained; no automated cleanup or TTL index is permitted.
- **Diagnostic Logs**: Retained for 30 days. Logs are heavily redacted (see below).

## Retention Cleanup and Holds

The backend retention worker implements the policies above in
`server/src/jobs/retentionPolicy.ts` and
`server/src/jobs/handlers/retentionCleanup.ts`. Eligible records are soft
archived, not deleted. Cleanup runs in batches and logs a per-category outcome;
worker failures follow the existing retry and dead-letter process.

Prompt reports and their evidence are stored in MongoDB by the
`/api/prompts/reports` handler; archived reports are hidden from normal listing
and remain available to authorized maintainers with `includeArchived=true`.

Schedule a daily `retention_cleanup` job with the backend enqueue command. Run
a dry run first:

```sh
cd server
npm run retention:enqueue -- --dry-run
```

After verifying dry-run behavior in a staging environment, schedule
`npm run retention:enqueue` daily; the enqueue command requires `MONGODB_URI`
and deduplicates concurrent daily jobs. The worker must also be running. Do not
enqueue this job until database migration `005_data_retention_controls` has
been applied: it removes the processed-webhook TTL index, which otherwise
bypasses holds and hard-deletes records. Apply migrations with
`cd server && npm run db:migrate`.

Before a dispute, legal request, or audit requires preservation, set
`retentionHold: true` and record the reason in `retentionHoldReason` on the
affected `InboundWebhookEvent`, `QuarantinedEvent`, `JobRecord`, or `Report`.
Release the hold only after the responsible reviewer documents that it is no
longer needed. The cleanup query rechecks the hold and eligibility conditions
at archive time to avoid racing with a newly applied hold.

The cleanup job never targets `AuditLog`, `LedgerEntry`, `Purchase`,
`PayoutStatement`, or `ProcessedEvent` records. Do not add TTL indexes or
automatic deletion for these collections without an approved retention policy.

## Deletion, Backup, and Redaction Behaviour

- **Deletion**: Users may request deletion of their off-chain profile data. Upon deletion, their username and bio are removed, but their on-chain wallet address remains visible in the ledger history.
- **Backup**: MongoDB collections containing marketplace metadata are backed up daily. Backups are retained for 90 days.
- **Backup copies**: Retention cleanup affects live MongoDB records only. Data scrubbed from a live record can remain in an older backup until that backup expires, for up to 90 days after its creation. Legal holds that must cover backup copies must also be applied through the backup provider's retention controls.
- **Redaction**: All diagnostic and application logs automatically scrub sensitive fields. IP addresses, session tokens, and the raw text of unlocked prompts are **never** written to disk.

## Sensitive Logging Restrictions
Contributors must ensure that application logs never capture:
- The actual prompt text (except for the public preview snippet).
- Cryptographic signatures or authentication nonces.
- Personally identifiable information (PII) beyond the public Stellar public key.

## Privacy-Safe Seller Analytics (#711)

Seller/support analytics are aggregated server-side from indexed purchases,
refunds, unlock audit events, and published reviews. The aggregation layer enforces:

- **Buyer identity redaction** — the seller-facing payload carries counts and
  rates (`conversionRate`, `refundRate`, `unlockSuccessRate`, satisfaction and
  average rating) and aggregated cohort sizes only. Raw buyer wallet addresses
  are consumed inside the aggregation and never included in API responses.
- **Minimum-cohort suppression** — a single buyer can never be isolated: any
  cohort below the configured threshold is reported as zero. See
  `MIN_COHORT_SIZE` in `src/lib/analytics/sellerAnalytics.ts`.
- **Aggregation-boundary discipline** — the pure aggregation helpers in
  `src/lib/analytics/sellerAnalytics.ts` are the only place raw activity
  events and buyer identities meet derived metrics. UI widgets consume only
  the aggregated shape.

Creator-facing endpoints (`/api/prompts/creator/:walletAddress/analytics/support-metrics`)
never expose buyer PII beyond the aggregated metrics described above.
