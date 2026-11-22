# Notification and webhook deduplication (#1223)

The repository already guarantees **deliver once per key** with unique
indexes. This change adds the other half of deduplication: deciding whether a
repeated key carries the **same content** or a different one, and exposing that
decision to operators.

## Surfaces covered

| Surface | Dedupe key | Stored proof | New behaviour |
| --- | --- | --- | --- |
| In-app notification | `(recipientWallet, type, dedupeKey)` | `Notification.message` + prompt context | Reusing a `dedupeKey` with different content is suppressed as a conflict and audited. |
| Inbound webhook | `InboundWebhookEvent.idempotencyKey` | `rawBody` | Reusing an idempotency key with different bytes returns HTTP 409 `WEBHOOK_IDEMPOTENCY_CONFLICT` instead of silently skipping. |
| Outbound webhook outbox | `(subscriptionId, dedupeKey)` | `payloadHash` (existing) | Unchanged; the worker already refuses a second row. |

## Classification

`server/src/services/deduplication.ts` is pure and has no database dependency.
A fingerprint is a SHA-256 over canonical JSON (object keys sorted, volatile
fields excluded), so retries fingerprint identically and different payloads do
not.

| Existing record | Incoming fingerprint | Status |
| --- | --- | --- |
| none | any | `new` |
| fingerprint differs | any | `conflict` — never retried |
| terminal (`processed`/`delivered`/`skipped`) | same | `duplicate` |
| `failed` / `dead_letter`, attempts < budget | same | `retry` |
| `failed`, attempts ≥ budget (8) | same | `permanent_failure` |
| in flight, lease younger than 5 minutes | same | `duplicate` |
| in flight, lease older than 5 minutes | same | `retry` (abandoned attempt) |
| legacy row with no fingerprint | any | terminal → `duplicate`; failed → `retry` |

Conflict detection is deliberately conservative: it only fires when the stored
content is comparable. Legacy rows without a stored body keep their previous
behaviour, so the change is backward compatible.

## Notification behaviour

`deliverNotification` still relies on the unique index as the source of truth.
When a duplicate-key error occurs it loads the existing row and:

1. compares the stored message and prompt context with the incoming content;
2. if different, returns `{ delivered: false, alreadyDelivered: true,
   suppressionReason: "dedupe_conflict" }` and writes an audit event whose
   reason contains `conflict=true`;
3. if identical, keeps returning a plain duplicate (`suppressionReason`
   absent), preserving the existing contract.

A conflicting notification is **not** written, so the first delivery stays the
single record of truth. Fix the producer and use a new dedupe key to send a
genuinely new notification.

## Inbound webhook behaviour

`verifyAndProcess` classifies a duplicate before returning:

- `conflict` → HTTP **409**, `code: "WEBHOOK_IDEMPOTENCY_CONFLICT"`; the
  request is rejected without touching business handlers.
- identical replay → HTTP **202** with status `skipped` (unchanged).
- failed original → status `failed` plus `dedupe: { status: "retry", retryable:
  true }`. Auto-retry is intentionally **not** enabled; the admin
  `POST /api/webhooks/inbound/:id/retry` endpoint remains the only replay path.

Signature verification is unaffected: a duplicate is resolved by the persisted
first event, exactly as before. A first delivery with a bad signature is still
marked `verification_failed` and returns 401.

## Observability (admin)

All routes require an admin token with scope `deduplication:read`.

- `GET /api/admin/deduplication/:kind/:key` — `kind` is `notification` or
  `webhook`; `key` is the notification `dedupeKey` or webhook
  `idempotencyKey`. Returns `found`, a content **fingerprint** (never the body),
  the stored status, retryability, and a remedy string.
- `GET /api/admin/deduplication/summary` — counters for keyed notifications,
  inbound processed/failed/skipped, and outbound pending/delivered/dead-letter.

There is no "clear dedupe record" endpoint on purpose: an operator should fix
the producer or replay from the dead-letter queue, not erase the guarantee.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Producer retries with the same bytes after a timeout | Duplicate (notification) / 202 (webhook); no second delivery. |
| Producer reuses a key for a corrected payload | Conflict; rejected and audited. Use a new key (for webhooks, a new event id). |
| Stored row predates fingerprints | Legacy path: terminal duplicates, failed rows retryable. |
| In-flight processing crashes | Lease expiry (5 min) makes the next attempt `retry`. |
| Attempt budget exhausted | `permanent_failure`; reconcile then replay from the dead-letter queue. |
| Fingerprint computation | SHA-256 over sorted JSON; no volatile timestamps or counters included. |
| Sensitive content | Fingerprints are one-way; admin responses return no message bodies or raw payloads. |

## Recovery and rollback

No schema change, no migration: the feature reuses existing collections and
columns (`Notification.message`, `InboundWebhookEvent.rawBody`).

1. Revert `notificationRouting.ts` to its previous duplicate branch and
   `inboundWebhookProcessor.ts`/`inboundWebhookControllers.ts` to return 202 for
   every duplicate. The unique indexes continue to deduplicate.
2. Remove the `/api/admin/deduplication` mount. Inspection data is derived, not
   stored, so nothing is left behind.
3. Existing notifications and webhook events remain valid; no backfill is
   needed. Conflicts already rejected can be replayed with a corrected producer
   and a new key.

## Tests

`server/src/tests/deduplication.test.ts` covers the pure classification matrix,
canonical fingerprint stability, notification conflict/duplicate integration,
webhook conflict/duplicate/retry integration, HTTP 409 vs 202, and the
authorization/validation surface of the admin controller.
