# Concurrency, notification, and ownership invariants

The existing implementations for issues #1204, #1150, and #1153 share the
same fail-safe rules:

- bounded workers clamp concurrency and batch size, authorize the actor before
  work starts, checkpoint only at batch boundaries, and stop after the
  configured consecutive-error threshold;
- notification delivery derives a stable recipient-scoped deduplication key,
  treats duplicate writes as successful retries, and keeps the original event
  audit trail; and
- ownership acceptance is an atomic claim bound to the pending request's
  expiry and current listing owner, so an expired or stale request cannot
  change ownership.

The recovery action for a rejected worker batch is to resume from its last
checkpoint. Notification retries reuse the same deduplication key. Ownership
callers must obtain a fresh transfer request after an expiry or ownership
conflict; no rejected path grants ownership or sends a duplicate notification.
