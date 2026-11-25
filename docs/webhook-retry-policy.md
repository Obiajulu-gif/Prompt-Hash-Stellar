# Webhook outbox retry policy and dead-lettering

Status: documents the behavior in `server/src/services/webhookOutboxWorker.ts`
after #606. Constants are exported as `WEBHOOK_RETRY_POLICY` and asserted by
`server/src/tests/webhookRetryPolicy.test.ts`.

## Policy

| Setting | Value | Purpose |
|---|---|---|
| Attempt budget (`maxAttempts`) | 8 | Deliveries that reach the subscriber. Exhausting it dead-letters the event. |
| Backoff base / cap | 2 s, doubling, capped at 30 min | Delay between retries |
| Jitter | Equal jitter: delay drawn from [cap/2, cap) | Spreads retries without ever retrying immediately |
| `Retry-After` (429) | Honored, capped at 30 min | Respects the subscriber's request without letting it park a row for days |
| Inactive-subscription checks | Every 30 s, at most `maxInactiveDeferrals` (about 24 h) | Waits for re-enable without burning attempts; then dead-letters |
| Delivery timeout | 10 s per attempt | A slow subscriber cannot hold a lease indefinitely |
| Lease | 60 s | A crashed worker's row is re-claimed after the lease expires |

## Which responses are retried

| Response | Behavior |
|---|---|
| 2xx | Delivered. Subscription failure count resets. |
| 408, 425 | Transient. Retried with backoff. |
| 429 | Retried. Uses `Retry-After` when present. |
| 5xx | Retried with backoff. |
| Other 4xx | **Dead-lettered immediately.** The subscriber rejected the event, and retries will not change that. |
| Network error or timeout | Retried until the attempt budget is exhausted. |
| Unsafe URL (SSRF guard) | Dead-lettered immediately. Retries cannot make the target safe. |
| Subscription deleted | Dead-lettered immediately. |
| Subscription inactive | Deferred without consuming attempts, up to the deferral cap. |

## Ordering

Each subscriber's events carry a sequence number. A **pending** earlier event holds
back later ones, so subscribers see events in order while an earlier event is
still being retried.

A **dead-lettered** earlier event does not hold back later events. Before this
change it did, and one permanent failure blocked every later event for that
subscriber indefinitely. Subscribers see the gap through `X-PromptHash-Sequence`.
Gaps are part of the contract.

## Dead letters

An event is dead-lettered when its retries are exhausted, its rejection is
permanent, or its subscription stays inactive past the deferral cap. Each one logs
a `[webhook-outbox] Event dead-lettered.` line with the row id, subscription id,
and reason. Logs never include the payload or the signing secret.

Admin routes (scoped auth required):

- `GET /api/webhooks/dead-letters?subscriptionId=&limit=`: list dead letters.
- `POST /api/webhooks/dead-letters/:id/replay`: reset one event to pending
  (attempts cleared).

Subscriber re-enable: a subscriber re-registers its webhook with
`POST /api/webhooks`, which requires an idempotency key header. Re-registration
sets the subscription active and clears its failure count.
Replaying dead letters afterward delivers the events that were held.

A subscription is automatically switched off after 10 consecutive dead-lettered
events. Switching it back on is a re-registration.

## Known gaps

- The subscriber is not notified by email or webhook when its events are
  dead-lettered. Operators and subscribers learn of it through the admin list and
  re-registration. Adding an active notification is a follow-up.
- The inactive-deferral counter is cumulative over a row's lifetime, not reset
  when the subscription flaps. A subscription that is off for 24 h in total is
  dead-lettered even if it was on in between.
