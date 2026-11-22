# Notification and Webhook Deduplication

Status: implemented for #1180.

This page covers how duplicate notifications and inbound webhook deliveries are
collapsed, what happens when processing fails, and how to recover or roll back
without re-delivering completed events.

## Guarantees

| Channel | Identity | Mechanism | Duplicate behavior |
| --- | --- | --- | --- |
| In-app notifications | `(recipientWallet, type, dedupeKey)` | Unique partial index on `Notification` | Insert-first; duplicate-key returns the stored row (`created: false`) |
| Inbound webhooks | `webhook:<source>:<eventId>` | Unique index on `ProcessedWebhookEvent.eventId` | One processor runs side effects; repeats get `409 DUPLICATE_EVENT` |
| Outbound webhooks | `(subscriptionId, dedupeKey)` | Unique index on `WebhookOutboxEvent` (unchanged) | Repeat enqueue is a no-op |

The source is part of the inbound key, so `github:evt-1` and `stripe:evt-1`
never suppress each other. Notification keys stay scoped by recipient and type,
so one event can notify two buyers, or produce a receipt and a security alert,
without either being muted.

## Inbound webhook lifecycle

1. **Authenticate.** HMAC signature and timestamp window are verified first.
   An invalid or stale delivery cannot reserve an event id, so it cannot
   suppress a later legitimate retry.
2. **Reserve.** `reserveWebhookDelivery` inserts the scoped key:
   - `acquired` — this request owns the reservation (5-minute lease).
   - `in_flight` — another request holds a live lease; return `409`.
   - `duplicate` — processing completed; return `409`.
3. **Process.** Business logic runs only after a successful reservation.
4. **Complete.** `completeWebhookDelivery` marks the row `processed` and
   refreshes its 24-hour retention window.
5. **Fail.** `failWebhookDelivery` records the truncated error, clears the
   lease, and leaves the row immediately re-acquirable. The response is `500`
   so the provider retries.

Reservations use compare-and-swap on `(status, attempts)`. Two workers racing a
failed or lease-expired row cannot both acquire it; the loser sees `in_flight`.

## Notification lifecycle

`deliverNotificationOnce` inserts before reading. A duplicate-key error returns
the stored notification with `created: false`. Any other storage error
propagates, so a transient failure is retryable instead of silently dropping
the notification. `deliverWithChannelDedup` uses this insert-first path,
removing its previous check-then-create race.

## Edge cases

| Situation | Behavior |
| --- | --- |
| Two concurrent first deliveries | One wins; the other gets `409 in_flight`. One side-effect run. |
| Retry after a `500` | Row is `failed`; the retry re-acquires and increments `attempts`. |
| Processor crashes mid-delivery | Row stays `in_flight`; after the 5-minute lease another retry re-acquires it. |
| Signature verification fails | No reservation is taken; a valid retry still processes. |
| Event id reused across sources | Independent keys; both process. |
| Same source reuses an id for a new event | Treated as a duplicate; payloads are not compared. Providers must use a new id. |
| Completed record "released" | Refused: release only deletes `in_flight`/`failed` rows. |
| Dedupe store unavailable | Storage error is rethrown, the handler returns `500`, and the provider retries. |
| Retention | TTL removes records 24 hours after completion or failure. Re-delivery after expiry processes again. |
| Notification create fails | Error propagates; nothing is recorded as delivered. |

## Recovery

Inspect the ledger with an admin token carrying `webhook:read`:

```http
GET /api/webhooks/dedupe?status=failed&limit=50
GET /api/webhooks/dedupe?key=webhook:github:evt-123
GET /api/webhooks/dedupe?source=github
```

Rows expose `status`, `attempts`, `lastError`, `leaseExpiresAt`,
`externalEventId`, and `dedupeKey`.

Release a stuck reservation with `webhook:write` and an `Idempotency-Key`:

```http
POST /api/webhooks/dedupe/<recordId>/release
Idempotency-Key: dedupe-release-2026-11-22-1
```

The release is audited as `webhook_dedupe_released` with the operator subject
and record id. Recovery order:

1. Fix the underlying cause (receiver bug, upstream outage, bad payload).
2. Prefer letting the provider retry; `failed` rows are immediately re-acquirable.
3. For stale `in_flight` rows, wait out the lease; a crashed processor is
   recovered by the next retry. Release only if no retry will come.

## Rollback

- Notification rows and keys are unchanged; old code reads them normally.
- New `ProcessedWebhookEvent` fields are additive with defaults. A code
  rollback restores the previous replay store, which treats scoped keys as
  opaque ids; the same TTL index expires them.
- No migration is required. Legacy unscoped rows expire within their existing
  24-hour window. During that overlap they can only suppress a duplicate (the
  safe direction); they cannot cause a double delivery.
- Outbound outbox deduplication was not changed.
- Releasing individual reservations is the supported way to stop enforcing
  deduplication. Bulk-deleting `processed` rows would re-enable replayed events.

## Verification

```bash
cd server
npx vitest run src/tests/deduplication.test.ts
```

The suite covers concurrent reservation, duplicate completion, failure and
immediate retry, stale-lease recovery, explicit release, cross-source scoping,
notification concurrency, error propagation, and the admin authorization chain.
