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

An overlapping duplicate receives an in-progress response without entering the controller. Once the original response finishes, retrying the same request replays that outcome, including a denial captured from the controller. Correct the authorization issue before starting a new operation.

## Concurrency coverage

The following scenarios must be covered by automated tests for every protected route:

- **Normal path:** first request with a new key executes the controller once and persists the response.
- **Concurrent duplicates:** two or more simultaneous requests with the same key and payload. Exactly one reserves the key and runs the controller; the others receive `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` without side effects. The reservation relies on the unique `(scope, key)` index, so a lost insert race is treated as an in-progress conflict, not an error.
- **Concurrent different payloads:** simultaneous requests with the same key but different payloads. Only the reserving request proceeds; the others receive `409 IDEMPOTENCY_KEY_CONFLICT` or `IDEMPOTENCY_REQUEST_IN_PROGRESS` depending on timing, and neither mutates state.
- **Failure path:** a controller error is persisted with its status code; a retry replays the failure rather than re-executing the side effect.
- **Retry after completion:** replays the stored status and body with `Idempotent-Replayed: true`.
- **Authorization path:** a request denied by the controller is persisted as the final outcome; a retry replays the denial. A request rejected before reservation (e.g. missing or invalid header) is not persisted.
- **Expiry:** keys older than 24 hours return `409 IDEMPOTENCY_KEY_EXPIRED`; the controller is not invoked.

## Edge cases and recovery

- **Crash during processing:** if the process dies after reservation but before the final outcome is stored, the record remains in-progress. Such records must be reclaimed by an operator (or a sweep job) once they exceed a staleness threshold; until then, retries receive `IDEMPOTENCY_REQUEST_IN_PROGRESS`. Callers should then generate a new key only after the operation's real state has been verified via the route's recovery endpoint, if one exists.
- **Rollback:** reservations are not rolled back on controller failure; the failure outcome is the persisted result. Disabling the feature requires no data rollback, since the protected routes simply stop requiring the header.
- **Migration compatibility:** existing response bodies are unchanged. Clients that do not send `Idempotency-Key` to protected routes will be rejected once enforcement is enabled, so the header must be rolled out to clients before `006_idempotency_records` enforcement is switched on.
