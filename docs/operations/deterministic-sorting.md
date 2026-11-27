# Deterministic Sorting for Mixed-Status Records, Status Lists, and Events (#1032, #1184)

In distributed blockchain architectures like PromptHash Stellar, records, service statuses, and events frequently exist in heterogeneous lifecycle states simultaneously:
- **Listing Prompts**: `active`, `pending`, `paused`, `flagged`, `quarantined`, `retired`
- **Ledger Events**: `committed`, `replayed`, `pending`, `quarantined`, `dlq`, `rolled_back`
- **Maintainer Grants**: `active`, `pending`, `expired`, `revoked`
- **Service Status & Health Components**: `down`, `degraded`, `up` / `healthy`
- **Operational Alerts & Maintenance Windows**: `critical`, `high` / `warning`, `medium`, `info` / `low`
- **Jobs & Webhook Events**: `dead_letter`, `failed` / `verification_failed`, `quarantined`, `processing`, `pending`, `processed` / `delivered` / `completed`, `skipped`

When querying, projecting, or paginating over mixed-status collections, ambiguous ordering and tie-breaking inconsistencies cause cursor drift, duplicate items, or skipped records across page boundaries.

The Deterministic Sorting Engine (`server/src/services/deterministicSorting.ts`) provides a mathematically guaranteed total ordering mechanism with tamper-evident HMAC cursors and domain-specific helpers wired across status and event list surfaces.

---

## 1. Mathematical Total Order Guarantee

For any two distinct records $A$ and $B$, the comparator guarantees:
1. **Antisymmetry**: If $A < B$, then $B > A$.
2. **Transitivity**: If $A \le B$ and $B \le C$, then $A \le C$.
3. **Totality / Strict Tie-Breaking**: No two records with different IDs ever evaluate as equal ($cmp(A, B) \ne 0$).

### Multi-Tier Comparator Sequence
```
1. Primary Metric (Ledger Sequence / Timestamp) [or Status Rank if groupByStatus is enabled]
2. Status Precedence Rank (Canonical hierarchy lookup)
3. Secondary Sequence Metric (txIndex / version / sequence / attempts)
4. Ultimate Immutable Tie-Breaker (Lexicographic comparison of unique ID or component name)
```

---

## 2. Canonical Status Precedence

Precedence maps assign a stable integer rank to each lifecycle status:

| Resource | Status Precedence Hierarchy |
| :--- | :--- |
| **Prompts** | `active` (1) > `pending` (2) > `paused` (3) > `flagged` (4) > `quarantined` (5) > `retired` (6) |
| **Events** | `committed` (1) > `replayed` (2) > `pending` (3) > `quarantined` (4) > `dlq` (5) > `rolled_back` (6) |
| **Grants** | `active` (1) > `pending` (2) > `expired` (3) > `revoked` (4) |
| **Service / Probe Status** | `down` (1) > `degraded` (2) > `up` / `healthy` (3) — ties broken by higher latency, then component name |
| **Operational Alerts / Banners** | `critical` (1) > `high` / `warning` (2) > `medium` (3) > `info` / `low` (4) — ties broken by timestamp, then ID |
| **Jobs & Webhook Events** | `dead_letter` (1) > `failed` / `verification_failed` (2) > `quarantined` (3) > `processing` (4) > `pending` (5) > `processed` / `delivered` / `completed` (6) > `skipped` (7) |

---

## 3. Wired Status & Event Surfaces (#1184)

- **Public Status (`api/status.ts` & `server/src/services/publicStatus.ts`)**: `derivePublicStatus(..., { deterministicOrder: true })` orders `services`, `probes`, and `maintenance` banners deterministically (`down`/`degraded`/`critical` surfaced first, stable name/id tie-breaking).
- **Operational Health Dashboard (`server/src/services/operationalHealthService.ts`)**: Deterministically orders `unresolvedExceptions`, `staleJobs`, and `activeIncidents` by severity/duration, timestamp, and ID regardless of collection query order.
- **MongoDB Event & Job Queries**:
  - `server/src/services/inboundWebhookProcessor.ts` (`listFailedEvents`, `listEventsByStatus`): `.sort({ createdAt: -1, _id: -1 })`
  - `server/src/services/webhookOutbox.ts` (`listDeadLetters`): `.sort({ deadLetteredAt: -1, _id: -1 })`
  - `server/src/jobs/jobQueue.ts` (`listJobs`, `getDeadLetterJobs`): `.sort({ createdAt: -1, _id: -1 })`

---

## 4. Tamper-Evident Pagination Cursors

Pagination cursors are encoded as signed base64url strings:
- **Payload**: `{ statusRank, primaryKey, secondaryKey, id }`
- **Integrity**: HMAC-SHA256 signature generated with server cursor secret.
- **Drift Resistance**: Because the cursor embeds the exact sort coordinates (and `getStatusRank` resolves synthetic `__rank_<n>` markers when the cursor record is deleted between pages), inserting, deleting, or transitioning records concurrently does not skip items or return duplicates.

---

## 5. Edge Cases, Failure Paths, Retry, and Rollback

- **Tampered or malformed cursors**: `decodeDeterministicCursor` fails closed with `DeterministicSortError("cursor_tampered" | "invalid_cursor")`; callers return HTTP 400 and never fall back to offset 0 silently.
- **Deleted cursor item during retry/pagination**: When the item referenced by `cursor` is removed before the next page request, `paginateMixedStatusRecords` locates the first element strictly greater than the cursor tuple using the preserved `statusRank`, `primaryKey`, `secondaryKey`, and `id`.
- **Missing or invalid timestamps**: `toEpochMs` normalizes `null`, `undefined`, or unparseable dates to `0` so NaN never breaks transitivity.
- **Authorization**: Admin status/event list endpoints (`GET /api/admin/operational-health`, `GET /api/webhooks/dead-letters`, `GET /api/webhooks/inbound/failed`, `GET /api/jobs`) retain their existing `requireAdminScope` guards (`health:read`, `webhook:read`, `jobs:read`).
- **Contract preservation & rollback**: All API response shapes remain unchanged. `derivePublicStatus` keeps `deterministicOrder` opt-in (enabled by `api/status.ts`) so existing unit callers preserve their exact array order unless requested. Rolling back requires no schema migration — simply revert the comparator/query tie-breaker changes.

---

## 6. Verification & Permutation Invariance

The utility `verifySortingInvariants` and `server/src/tests/deterministicSorting.test.ts` verify that:
- Any permutation of input records (original, reversed, seeded shuffle) produces the **identical** sorted sequence and SHA-256 fingerprint.
- Multi-page pagination across mixed-status collections has zero duplicates and zero missing items, even if the cursor anchor record is deleted between pages.
- Status components, maintenance banners, operational alerts, and webhook/job event lists are permutation-invariant.
