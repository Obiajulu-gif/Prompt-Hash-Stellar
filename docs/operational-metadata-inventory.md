# Operational metadata inventory and minimization (#915)

This inventory distinguishes data needed to run the marketplace from
diagnostic copies that should be bounded or scrubbed. `Required` means needed
for a documented product, idempotency, audit, support, or compliance purpose;
it does not mean unrestricted access or indefinite retention. `Sensitive`
means access must be limited and the field must not be copied into logs or
unrelated metadata. `Removable` means the value is not needed after its stated
purpose and should be omitted or scrubbed at the boundary.

## Inventory

| Store / fields | Classification | Purpose and minimization decision | Retention / cleanup |
| --- | --- | --- | --- |
| `TimelineEvent`: `eventType`, `visibility`, `resourceType`, `resourceId`, `summary`, timestamps | Required | User-facing activity and navigation. Keep summaries short and free of prompt contents, payment details, and credentials. | TTL removes timeline events after 90 days. |
| `TimelineEvent`: `actorWallet`, `recipientWallet` | Sensitive, required | Identify the event actor and enforce recipient-scoped dashboard access. Do not duplicate these identifiers into diagnostic metadata or logs; keep the existing wallet-scoped access checks. | Existing 90-day timeline TTL. |
| `TimelineEvent.metadata` | Optional, allowlisted | Only the fields in `OPERATIONAL_METADATA_FIELDS` are stored. String values are bounded and control characters rejected; attempts and durations have numeric bounds. Wallet addresses, IPs, raw bodies, signatures, prompt text, nested objects, and unknown keys are dropped. | Same 90-day TTL as its parent timeline event. |
| `InboundWebhookEvent`: `idempotencyKey`, event type/source, verification/processing status, attempt count, processing timestamps | Required, operationally sensitive | Stable event identity prevents duplicate work; statuses and bounded counters support incident diagnosis. Restrict access to operational/admin tooling. | Retain stable idempotency metadata after payload archival. |
| `InboundWebhookEvent.rawBody`, `rawHeaders`, `errorMessage` | Sensitive, removable | Raw payload is retained only to diagnose or retry a delivery. Raw headers may contain identifiers; never persist authorization/cookie/signature secrets. Error text should be a bounded, non-sensitive explanation. | Successfully processed/skipped rows are archived and body, headers, and error message cleared after 30 days. Failed, unresolved, or held records remain until resolved/released from hold. |
| `QuarantinedEvent`: `eventId`, ledger, transaction hash, contract, topic, reason, status, retry count | Required for replay/audit | Identify an on-chain event and explain decoder/replay outcome. Keep stable identifiers and reason codes; do not include wallet secrets or decrypted prompt content. | Stable event identity remains for deduplication. |
| `QuarantinedEvent.rawTopic`, `rawValue`, `rawXdr`, `errorDetails` | Sensitive, removable | Raw chain envelopes and decoder errors are needed only while diagnosing or replaying a quarantined event; they can contain arbitrary input. | Replayed/discarded rows are scrubbed after 30 days; quarantined or held rows are excluded. |
| `JobRecord`: type/status, dedupe key, attempts, scheduling/lease/completion times | Required while work is active | Queue correctness, idempotency, retries, and recovery. Keep stable operational state, not request dumps. | Terminal CSV-export jobs are scrubbed after 30 days. Other terminal job types need a per-type retention decision before adding cleanup; do not add a blanket TTL that could erase retry/recovery evidence. |
| `JobRecord.payload`, `lastError`, `attemptHistory` | Sensitive, optional for recovery | Job-specific payloads and free-form errors can carry identifying data. Keep only fields needed by the active job handler; never put secrets or full requests in payloads/errors. | Export jobs replace payload with an archived marker and clear error/history after 30 days. For other job types, owners should minimize at creation and define a terminal retention window before additional cleanup. |
| `WebhookOutboxEvent`: dedupe/event/delivery IDs, sequence, hash, schema version, status, attempts/checkpoint/timestamps | Required for delivery guarantees | These fields ensure stable delivery identity, order, verification, and recovery after ambiguous responses. | Preserve identity while the outbox/idempotency policy requires it. Do not TTL-delete pending, leased, or dead-letter deliveries. |
| `WebhookOutboxEvent.payload`, `lastError` | Sensitive, required only until delivery/recovery ends | Payload is delivered to the subscriber and may include marketplace identifiers. Outbound payloads are deny-list redacted and bounded before persistence; errors should be bounded and not include request bodies, secrets, or subscriber credentials. | No generic outbox cleanup policy is currently implemented. Before removing delivered payloads, define a retention window and preserve dedupe identity/sequence so old events cannot be enqueued or delivered again. Dead letters must remain until resolved or explicitly discarded. |
| `WebhookSubscription.url`, `secret`, `previousSecret` | Highly sensitive, product-required | URL is required for delivery; current signing secret verifies/signs deliveries; previous secret is necessary only during key-rotation grace. Never log or return these from subscription reads. | Rotation records a 24-hour grace expiry, but no cleanup job currently clears the old secret after expiry. Add an expiry-aware scrub before treating this as fully minimized; deletion removes the subscription. |
| `IdempotencyRecord.scope`, key, request hash, outcome/status code, response body, expiry | Sensitive, required temporarily | Key/hash gate retries and prevents duplicate mutations. The response body exists to replay the original API result; keep API responses free of secrets and unnecessary personal data. | Records expire after 24 hours; preserve this window to avoid duplicate effects on delayed retries. |
| `AuditLog`: action/result, actor, target/resource identifiers, request ID, reason code, hash-chain fields | Restricted, required for accountability and tamper evidence | Append-only history supports security review and compliance. Wallets are stored as hashes; request/actor/resource identifiers remain restricted and export profiles redact or pseudonymize fields for external sharing. | Permanent retention under the current audit policy; no TTL or general cleanup. |
| `AuditLog.clientIp` | Sensitive, removable | IP is not included in the audit hash, export schema, or required audit correlation (request ID, actor, action, and outcome are retained). It is removed from new audit writes and scrubbed from historical rows by migration `008_minimize_audit_client_ip`. | One-time irreversible `$unset` migration. Do not restore IP values on rollback. Existing backup copies age out under the backup retention policy. |
| `AuditLog.beforeState`, `afterState`, `metadata`, `reason` | Optional and potentially sensitive | Preserve only state transitions and stable reason codes needed to explain the specific audited action. Never store prompt text, credentials, raw signatures, complete request bodies, or payment secrets. These free-form fields require call-site review when adding new actions. | Permanent audit policy prevents routine deletion; minimize before insertion and use the export redaction profiles for disclosure. Historical values cannot be safely rewritten without a separately reviewed integrity/retention plan. |
| `Report`: prompt/report identifiers, reason/status/resolution timestamps | Required for moderation/support | Needed to act on, resolve, and reference a report. | Retain while active; resolved/dismissed reports are scrubbed after 365 days unless held. |
| `Report.reporterAddress`, description, evidence URLs, admin notes | Sensitive, optional support evidence | Needed only to assess/resolve a case. Evidence links and free text may identify a reporter or include third-party data; limit maintainer access and avoid adding raw attachments to logs. | Scrub reporter address, description, evidence, and notes after 365 days from resolution/dismissal unless held. |
| `OperationFailure`: operation/resource/external reference IDs, severity, retry state/counters, timestamps | Restricted, required for recovery | These fields identify the failed operation and support safe retries/manual remediation. Related resource identifiers may be wallet or prompt IDs and must not be copied to logs. | No general retention policy currently covers this collection; define a terminal-state window and scrub plan before adding automatic deletion. |
| `OperationFailure.failureReason`, `errorDetails`, `metadata`, resolution notes/escalation error | Sensitive free-form operational data | These fields can capture exception text or arbitrary payloads. Prefer stable `errorCode`/reason enums and allowlisted metadata; do not store raw requests, credentials, prompt content, or payment data. | No generic cleanup currently exists. Restrict access and add a per-type retention policy before archiving terminal failures. |
| `OperationCheckpoint`: operation/user/idempotency IDs, step states, transaction hashes, retry state | Restricted, required while recoverable | Checkpoints prevent duplicate marketplace/chain writes and let operators resume or reconcile ambiguous operations. | Do not scrub unresolved checkpoints. Define a terminal retention period that preserves reconciliation requirements before cleanup. |
| `OperationCheckpoint.steps[].data`, errors, and `payload` | Sensitive, minimal operational input only | These flexible fields can carry arbitrary data; persist only state needed for retry/reconciliation and never prompt text, signing material, credentials, or complete HTTP requests. | No generic checkpoint retention cleanup currently exists; review payload contents at call sites and define cleanup for terminal rows. |
| `ChangeHistoryEntry` and `SupportCaseTimelineEvent`: state diffs, actor, reason, payload, chain hashes | Restricted, required for immutable accountability/support history | Hash-chained records support critical-change review and case timelines. Flexible state/payload/reason values must contain only the minimal change or case evidence, not secrets. | Append-only today; no general cleanup. Do not remove fields without a versioned hash/integrity migration and approved retention policy. |
| Diagnostic logs | Sensitive, ephemeral | Keep only correlation ID, route template, status, duration, stable codes, and safe identifiers. Redaction is defense-in-depth; producers must not log raw request, prompt, signature, IP, token, cookie, or payment details. | 30-day log retention; ensure hosted log platform settings match this policy. |

## Write-boundary rules

- For timeline event `metadata`, use `minimizeOperationalMetadata`; its exported
  allowlist is the authoritative field contract and is covered by tests.
- Use stable reason/error codes rather than copying exception text or user
  supplied values into durable metadata. A field allowlist is not a substitute
  for checking the contents of an allowed value.
- Hashes and opaque identifiers are pseudonymous, not anonymous. Keep them
  access-controlled and retain them only for their stated purpose.
- Keep raw event data only while replay/support needs it; scrub terminal data
  through the hold-aware retention worker, never an unmanaged TTL index.
- Do not expand permanent audit fields or introduce a new operational store
  without adding the field, purpose, sensitivity, and retention decision to
  this inventory and corresponding tests.

## Migration and cleanup guidance

Migration `008_minimize_audit_client_ip` removes `clientIp` from all existing
`auditlogs` documents. This is an intentional irreversible privacy scrub:
the field is not part of the hash-chain digest, and the migration leaves all
auditable action, actor, target, outcome, request ID, and chain hashes intact.
Before deployment, count affected rows with a read-only query such as
`db.auditlogs.countDocuments({ clientIp: { $exists: true } })`; apply the normal
server migration (`cd server && npm run db:migrate`), then verify the same
count is zero. No application configuration change is required. A rollback
does not restore the removed IP values; restore a backup only if legally
required and after privacy review.

The existing hold-aware retention worker handles inbound events, quarantined
events, terminal export jobs, and resolved support evidence. Review its dry-run
counts before enabling cleanup, and do not change the permanent audit,
financial, or blockchain retention classes without a separate approved
policy. Backups are separate copies and may retain scrubbed values until their
own expiration.

## Validation

Run the focused checks from the repository root after installing dependencies:

```sh
corepack yarn --cwd server vitest run src/services/operationalMetadata.test.ts src/tests/auditMetadataMinimization.test.ts
```

The tests assert that unknown/sensitive fields and invalid or oversized values
are dropped, the allowlist remains explicit, new audit records omit IPs, and
the legacy scrub migration targets only documents carrying `clientIp`.