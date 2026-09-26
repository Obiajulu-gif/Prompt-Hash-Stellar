# Unlock Security Runbook

## Support Audit Timelines

Unlock support disputes should be reviewed from the immutable audit log through `buildUnlockSupportTimeline`. The export contains only hashed wallet identifiers, prompt id, action/result pairs, request ids, reason codes, and hash-chain fields. It never includes plaintext prompts, raw wallet signatures, challenge secrets, private keys, or client IP addresses.

Decision states:

- `allowed`: the latest unlock event is `unlock_success`.
- `denied`: the latest unlock event failed expected access or signature checks.
- `blocked`: the latest unlock event was blocked by replay, stale prompt terms, rate limits, or ledger/indexer verification.
- `indeterminate`: no unlock decision has been recorded yet.

`indexerStatus` is `missing` when ledger verification failed, which gives support a deterministic way to distinguish user access denial from unavailable or stale on-chain indexing.

## Price and Version Binding

Challenge tokens may include `promptVersion` and `expectedPriceStroops`. Those values are included in the wallet challenge message and HMAC-signed token payload. During unlock, the service fetches the prompt again and rejects stale submissions with `STALE_PROMPT_TERMS` when the current price or version claim no longer matches the token.

Clients should request a fresh challenge whenever the prompt detail view is refreshed, the displayed price changes, or a signing attempt is resumed from an old browser tab.

## Webhook Replay Protection

Webhook deliveries include:

- `schemaVersion` in the JSON body.
- `X-PromptHash-Event-Version`.
- `X-PromptHash-Timestamp`.
- `X-PromptHash-Event-Id`.
- `X-PromptHash-Delivery`.

The HMAC signature covers timestamp, event id, delivery id, and the exact body. Consumers should reject signatures outside a five-minute replay window and should persist `(eventId, deliveryId, schemaVersion)` as an idempotency key before applying side effects.
