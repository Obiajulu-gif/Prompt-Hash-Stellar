# Audit Log Usage — Challenge & Unlock Flows

_Issue #145 — Add unlock audit trail for wallet challenge and prompt access attempts_

---

## Overview

Every challenge issuance and prompt unlock attempt creates a structured, immutable record in the `auditlogs` MongoDB collection. Records link the attempt to a prompt ID, wallet address, request ID, timestamp, result, and failure reason — without storing any plaintext prompt content or cryptographic key material.

---

## Schema

```ts
{
  action:        AuditAction,   // stable code for the event type
  result:        AuditResult,   // "success" | "failure" | "blocked"
  promptId:      string | null, // on-chain prompt ID
  walletAddress: string | null, // lowercase wallet address
  requestId:     string | null, // UUID from X-Request-ID header
  clientIp:      string | null, // originating IP address
  reason:        string | null, // stable failure reason code
  createdAt:     Date,          // auto-set by Mongoose
  updatedAt:     Date,
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

### Reason codes

| Reason | Used with |
|--------|-----------|
| `rate_limit_exceeded` | `challenge_rate_limited` |
| `ip_rate_limit_exceeded` | `unlock_rate_limited` (IP bucket) |
| `wallet_rate_limit_exceeded` | `unlock_rate_limited` (wallet bucket) |
| `invalid_signature` | `unlock_invalid_signature` |
| `expired_challenge` | `unlock_expired_challenge` |
| `no_access` | `unlock_no_access` |
| `integrity_failure` | `unlock_integrity_failure` |
| `error` | `unlock_error` |

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
