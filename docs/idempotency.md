# Idempotency and replay protection

High-risk write routes require an `Idempotency-Key` header. The key is scoped to
one route and retained with the request fingerprint and the final HTTP outcome
for 24 hours.

```http
Idempotency-Key: purchase-2026-09-29-001
Content-Type: application/json
```

## Protected routes

The current protected mutation surfaces are:

- `POST /api/versions/update`
- `POST /api/versions/purchase`
- `POST /api/prompts/licensing/update`
- `POST /api/prompts/transfers/request`
- `POST /api/prompts/transfers/:transferId/respond`
- `POST /api/prompts/transfers/:transferId/cancel`
- `POST /api/bundles`
- `POST /api/bundles/:id/purchase`
- `POST /api/bundles/purchases/:purchaseId/recover`
- `POST /api/fulfillment` and fulfillment refund/retry/resolve/close/sweep actions
- `POST /api/payouts/entry`
- `POST /api/receipts`
- `POST /api/reviews/submit`
- `POST /api/recovery/:operationId/retry|resolve`
- `POST /api/invitations` and invitation accept/revoke actions
- Outbound webhook subscription, secret rotation, and dead-letter replay writes
- Entitlement revoke/repair, moderation bulk/rollback, wallet-session issuance,
  and asynchronous export initiation

Inbound webhooks have a separate event-id based implementation and are not
changed by this workflow.

## Behavior

- The first request reserves the key before the controller runs.
- A retry with the same key and the same JSON payload replays the persisted
  status code and response body. Replays include `Idempotent-Replayed: true`.
- A key used with a different route payload returns `409` with code
  `IDEMPOTENCY_KEY_CONFLICT`.
- A request still being processed returns `409` with code
  `IDEMPOTENCY_REQUEST_IN_PROGRESS`.
- A retained but expired key returns `409` with code
  `IDEMPOTENCY_KEY_EXPIRED`; callers must generate a new key.
- Failed responses are persisted and replayed too. This prevents a client retry
  after a timeout or error from repeating a partial side effect.

Keys must be non-empty, no longer than 255 characters, and contain no line
breaks. Never reuse a key for a different business operation or payload.

## Deployment

Run the normal server migration command before enabling the protected routes:

```bash
npm --prefix server run db:migrate
```

Migration `006_idempotency_records` creates the unique `(scope, key)` index and
lookup indexes. Existing routes keep their response bodies; only requests to
the protected routes need the new header.
