# Dead-letter inspection and safe retry tooling

Provides operational visibility and safe remediation tooling for dead-lettered background jobs and webhook outbox events.

```bash
# List dead-letter records
node scripts/dead-letter-tool.mjs list
node scripts/dead-letter-tool.mjs list --queue=jobs
node scripts/dead-letter-tool.mjs list --queue=webhooks --limit=20
node scripts/dead-letter-tool.mjs list --json

# Safe retry preview (dry-run)
node scripts/dead-letter-tool.mjs retry --all --dry-run
node scripts/dead-letter-tool.mjs retry --id=job-123 --dry-run

# Execute throttled safe retry
node scripts/dead-letter-tool.mjs retry --id=job-123 --actor=ops-oncall
node scripts/dead-letter-tool.mjs retry --all --batch-size=10 --delay-ms=50 --actor=ops-oncall
```

## Features

- **Multi-queue visibility**: Inspect dead-lettered items from background jobs and webhook outbox in one view.
- **Secret redaction**: Payloads containing sensitive tokens, passwords, private keys, or authorization headers are masked with `[REDACTED]`.
- **Dry-run simulation**: Preview planned retry actions, affected target queues, and item counts without mutating records.
- **Throttled execution**: Configurable batch sizing (`--batch-size`) and inter-batch delays (`--delay-ms`) to prevent overwhelming downstream services or databases.
- **Authorization boundaries**: Enforces operator privileges (`--actor` / `DLQ_ADMIN_TOKEN`), rejecting unauthenticated or unprivileged actors.

## Safety and Rollback

1. **Pre-flight verification**: Always run `--dry-run` first to preview the impact of re-queuing records.
2. **Controlled batching**: When retrying large volumes of dead letters, set `--batch-size=5` or `--batch-size=10` and `--delay-ms=100` to smoothly throttle load.
3. **Idempotent retry**: Retrying a dead-letter item resets its attempt counter and schedules it for processing. If the downstream target remains broken, the item will exhaust its retry budget and return to dead-letter state without data loss.
4. **Audit trail**: Every retry operation records the acting operator identity, processed counts, and failure diagnostics.
