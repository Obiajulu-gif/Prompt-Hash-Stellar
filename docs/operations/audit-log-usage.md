# Audit Log Usage — Challenge & Unlock Flows

_Issue #145 — Add unlock audit trail for wallet challenge and prompt access attempts_

---

## Overview

Every challenge issuance and prompt unlock attempt creates a structured, immutable record in the `auditlogs` MongoDB collection. Records link the attempt to a prompt ID, wallet address, request ID, timestamp, result, and failure reason — without storing any plaintext prompt content or cryptographic key material.

---

## Schema

```ts
{
  action:           AuditAction,   // stable code for the event type
  result:           AuditResult,   // "success" | "failure" | "blocked"
  promptId:         string | null, // on-chain prompt ID
  walletAddress:    string | null, // SHA-256 of the lowercase wallet address
  actor:            string | null, // admin token subject for admin actions
  requestId:        string | null, // UUID from X-Request-ID header
  clientIp:         string | null, // originating IP address (never exported)
  reason:           string | null, // stable failure reason code
  recordHash:       string,        // integrity hash of this record
  previousHash:     string,        // recordHash of the previous record
  integrityVersion: number | null, // hash algorithm; null = legacy (v1)
  createdAt:        Date,          // the exact timestamp that was hashed
  updatedAt:        Date,
}
```

### Action codes

| Action | Trigger |
|--------|---------|
| `challenge_issued` | Challenge token successfully created |
| `challenge_rate_limited` | Challenge request blocked by rate limiter |
| `unlock_success` | Prompt decrypted and returned to caller |
| `unlock_invalid_signature` | Wallet signature did not verify |
| `unlock_expired_challenge` | Challenge token expired before use |
| `unlock_no_access` | Caller has not purchased the prompt |
| `unlock_integrity_failure` | Decrypted content hash mismatch |
| `unlock_error` | Unexpected error during unlock |
| `unlock_rate_limited` | Unlock request blocked by rate limiter |
| `unlock_stale_listing_snapshot` | Listing changed after the challenge was signed |
| `admin_auth_success` / `admin_auth_denied` | Admin token accepted / rejected by `requireAdminScope` |
| `audit_export` | An admin exported audit records |
| `prompt_restrict` / `prompt_reinstate` / `prompt_retire` | Moderation decision (`api/prompts/moderate.ts`) |
| `moderation_unauthorized` / `moderation_error` | Rejected or failed moderation attempt |
| `dispute_*` | Disputed-purchase transition (see [Disputed purchases](#disputed-purchases)) |

### Reason codes

| Reason | Used with |
|--------|-----------|
| `rate_limit_exceeded` | `challenge_rate_limited` |
| `ip_rate_limit_exceeded` | `unlock_rate_limited` (IP bucket) |
| `wallet_rate_limit_exceeded` | `unlock_rate_limited` (wallet bucket) |
| `entitlement_rate_limit_exceeded` | `unlock_rate_limited` (buyer/prompt/failure composite buckets) |
| `invalid_signature` | `unlock_invalid_signature` |
| `expired_challenge` | `unlock_expired_challenge` |
| `no_access` | `unlock_no_access` |
| `integrity_failure` | `unlock_integrity_failure` |
| `error` | `unlock_error` |

### Composite (buyer / prompt / failure-reason) throttling

Unlock attempts are additionally throttled on composite keys so a single buyer cannot probe one prompt repeatedly:

- **IP bucket** — `checkRateLimit("unlock", clientIp)` (generic per-IP guard).
- **Wallet bucket** — `checkRateLimit("unlock", address)` (per-buyer guard).
- **Buyer+prompt bucket** — `checkRateLimit("unlock", address, { scope: "prompt:<id>" })` — repeated unlock attempts for the same prompt are throttled (max 8 / 60s).
- **Failure-reason bucket** — `checkRateLimit("unlock", address, { scope: "prompt:<id>:reason:<reason>" })` for `no_access` and `ledger_verification_failed` (max 3 / 60s each).

All composite buckets inherit the `unlock` classification (`security`), so they fail closed when Redis is unavailable. Legitimate retries shortly after an indexer delay remain permitted because the windows are generous relative to a normal retry cadence. Throttled composite attempts are recorded with `action: "unlock_rate_limited"` and `reason: "entitlement_rate_limit_exceeded"`.

---

## Redaction Rules

The following values are **never** stored in audit records:

- Prompt plaintext or decrypted payload
- Encryption keys or wrapped key material
- Challenge secrets or HMAC signing keys
- Raw wallet signatures (`signedMessage`)
- Private keys

Only stable, non-sensitive identifiers (wallet address, prompt ID, request ID, IP, reason code) are persisted.

---

## Querying Audit Logs

Use the `queryAuditEvents` service function from `server/src/services/auditTrail.ts`, or query MongoDB directly.

### Using the service

```ts
import { queryAuditEvents } from "./server/src/services/auditTrail";

// All unlock failures for a wallet in the past 24 hours
const records = await queryAuditEvents({
  walletAddress: "GABC...",
  result: "failure",
  since: new Date(Date.now() - 24 * 3600_000),
  limit: 100,
});

// Full access history for a specific prompt
const history = await queryAuditEvents({ promptId: "42" });

// All rate-limited attempts in the past hour
const blocked = await queryAuditEvents({
  action: "unlock_rate_limited",
  since: new Date(Date.now() - 3600_000),
});
```

### Direct MongoDB queries

```js
// All failures for a wallet, most recent first
db.auditlogs.find(
  { walletAddress: "gabc...", result: "failure" },
  { action: 1, reason: 1, promptId: 1, createdAt: 1 }
).sort({ createdAt: -1 }).limit(50)

// All events with a specific requestId (correlates challenge + unlock)
db.auditlogs.find({ requestId: "550e8400-e29b-41d4-a716-446655440000" })

// Count failures per reason code (incident analysis)
db.auditlogs.aggregate([
  { $match: { result: "failure", createdAt: { $gte: ISODate("2025-05-01") } } },
  { $group: { _id: "$reason", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])

// Wallets with more than 5 invalid_signature failures (brute-force detection)
db.auditlogs.aggregate([
  { $match: { action: "unlock_invalid_signature" } },
  { $group: { _id: "$walletAddress", count: { $sum: 1 } } },
  { $match: { count: { $gt: 5 } } }
])
```

---

## Incident Response

### Scenario: User reports they cannot unlock a prompt

1. Find all audit events for their wallet and the prompt ID:
   ```js
   db.auditlogs.find(
     { walletAddress: "gabc...", promptId: "42" },
   ).sort({ createdAt: -1 }).limit(20)
   ```
2. Check the `reason` field on failure records:
   - `no_access` → user has not purchased; verify on-chain with `hasAccess()`
   - `expired_challenge` → they waited too long to sign; re-issue challenge
   - `invalid_signature` → wallet mismatch or corrupted signature
   - `integrity_failure` → contact engineering immediately (data issue)

3. Correlate with request ID: look up the same `requestId` in application logs for the full stack trace.

### Scenario: Suspicious unlock pattern

```js
// Find IPs with > 20 unlock attempts in the past hour
db.auditlogs.aggregate([
  { $match: { action: { $in: ["unlock_success","unlock_invalid_signature","unlock_no_access"] },
              createdAt: { $gte: new Date(Date.now() - 3600000) } } },
  { $group: { _id: "$clientIp", count: { $sum: 1 } } },
  { $match: { count: { $gt: 20 } } }
])
```

Block or investigate the identified IPs.

---

## Exporting activity for audits

_Issue #783 — audit-grade admin activity export_

`GET /api/audit/export` returns a filtered, tamper-evident export. It needs an
admin token with the `audit:export` scope, and each export is itself recorded
as an `audit_export` event.

| Query param | Meaning |
|-------------|---------|
| `actor` | Admin token subject, or a raw wallet address (matched by its hash) |
| `action` | Comma-separated action codes |
| `scope` | `admin`, `moderation`, `dispute`, or `unlock` — expands to that group's action codes (intersected with `action` when both are given) |
| `promptId` | On-chain prompt ID |
| `since`, `until` | ISO-8601 date range (inclusive) |
| `limit` | Records per page, 1–10000 (default 1000) |
| `after` | `nextCursor` from the previous page |

Response:

```jsonc
{
  "exportVersion": 1,
  "exportedAt": "2026-09-24T10:00:00.000Z",
  "recordCount": 2,
  "filters": { "actor": "[REDACTED_HASH]", "scope": "moderation", "limit": 1000 },
  "records": [
    {
      "sequence": 1,
      "createdAt": "2026-09-20T08:15:00.000Z",
      "action": "prompt_retire",
      "result": "success",
      "promptId": "42",
      "walletHash": "9f2c…",        // SHA-256 of the wallet, never the raw address
      "actor": null,
      "requestId": "…",
      "reason": "copyright",
      "recordHash": "…",
      "previousHash": "…",         // chain reference to the preceding record
      "integrityVersion": 2
    }
  ],
  "integrityChecksum": "…",
  "hasMore": false,
  "nextCursor": null
}
```

Exports never contain client IPs, raw wallet addresses, or prompt content —
the audit trail does not store prompt payloads at all. Large result sets are
streamed from a cursor and paged: keep requesting with `after=<nextCursor>`
until `hasMore` is `false`.

### How records are hashed

- **Version 2** (records written since #783):
  `recordHash = SHA-256(canonicalJson({ action, result, promptId, walletAddress, actor, requestId, reason, createdAt, previousHash, integrityVersion }))`
- **Version 1** (legacy records, `integrityVersion` null/1):
  `recordHash = SHA-256(JSON.stringify({ action, result, promptId, walletAddress, requestId, createdAt, previousHash }))`
  with the keys in exactly that order.

`canonicalJson` sorts object keys recursively and drops `undefined` members;
`createdAt` is the ISO-8601 string. In an export, `walletAddress` is the
record's `walletHash`. The first record chains from 64 zeros.

`integrityChecksum = SHA-256` over every exported record, in order, each as
`canonicalJson(record) + "\n"`.

### Verifying an export

Send the bundle back to `POST /api/audit/export/verify` (scope `audit:export`):

```json
{ "valid": true, "recordCount": 2, "checksumValid": true, "errors": [] }
```

It checks that:

1. the checksum still matches the records (nothing added, removed, reordered, or edited);
2. every record still hashes to its own `recordHash`; and
3. every record matches the stored audit record with that hash, which must in
   turn still pass its own hash check.

Auditors without API access can repeat steps 1–2 offline with the algorithm
above. On an unfiltered export, each record's `previousHash` must also equal
the preceding record's `recordHash`. `verifyAuditTrail()` re-checks the whole
stored chain.

## Disputed purchases

_Issue #755 — escrow-style disputed purchase resolution_

When the ledger confirms a buyer paid but the unlock then fails (integrity
failure, IPFS/decryption error), the purchase's `FulfillmentRecord` becomes a
recoverable dispute. Every transition goes through
`server/src/services/purchaseDisputes.ts` and emits one `dispute_<event>`
audit record with `reason: "<from>-><to>"`:

| Event | From → to | Triggered by |
|-------|-----------|--------------|
| `unlock_failed` | pending/delivered/failed/retrying/rejected/resolved → `failed` | unlock endpoint |
| `unlock_succeeded` | pending/failed/retrying → `delivered` | unlock endpoint |
| `retry_scheduled` | failed/refund_requested → `retrying` | maintainer |
| `refund_requested` | pending/failed/retrying → `refund_requested` | buyer, or on-chain `DisputeOpened` |
| `refund_approved` / `refund_rejected` | failed/retrying/refund_requested → `refunded`; refund_requested → `rejected` | maintainer |
| `resolved` | failed/retrying/refund_requested/rejected → `resolved` (notes required) | maintainer |
| `escalated` | pending/failed/retrying → `refund_requested` after `FULFILLMENT_TIMEOUT_MS` | `POST /api/fulfillment/auto-refund-sweep` |
| `refund_settled` | failed/retrying/refund_requested → `refunded` | on-chain `DisputeResolved(refunded)` |

Transitions are conditional updates, so two concurrent actions cannot both
apply. Replays are acknowledged without being applied again (`idempotent: true`
in the response), whether they come from a redelivered event (keyed by chain
event ID or unlock request ID) or a repeated admin action (the
`Idempotency-Key` header).

## Immutability

Audit records are append-only. Mongoose pre-hooks on `findOneAndUpdate`, `updateOne`, and `updateMany` throw if any code attempts to mutate an existing record. To correct an erroneous record, insert a new corrective record rather than deleting or editing the original.

---

## Retention

Audit logs are retained indefinitely by default. To add a TTL index (e.g., 90 days):

```js
db.auditlogs.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 3600 }
)
```

Apply this only after confirming compliance requirements allow it.

---

## Related Documents

- [Runbook](./runbook.md) — Operational monitoring
- [Incident Response](./incident-response.md) — Escalation procedures
- [Security Audit](../security-audit.md) — AUD-02, AUD-04, AUD-07
