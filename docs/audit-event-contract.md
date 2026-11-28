# Audit-Event Contract

_Issue #1094 — Versioned audit events with redaction rules, schema validation,
and backward-compatibility guarantees._

## Overview

Security-sensitive actions (purchases, admin moderation, fee changes, contract
upgrades) must remain queryable across contract deploys without exposing
secrets or personal data in log sinks.  This document defines:

1. The event envelope — fields every audit event carries.
2. Event names and actor/resource/correlation fields.
3. Redaction rules — what is excluded, hashed, or sentineled.
4. Schema versioning and backward-compatibility policy.
5. Retention and migration behavior for older event versions.

**Implementation:** `packages/sdk/src/audit/`

---

## Event Envelope

Every audit event is an `AuditEvent<P>` object (defined in `types.ts`):

```ts
interface AuditEvent<P extends Record<string, unknown>> {
  schemaVersion: AuditSchemaVersion;   // 1 today; bump on breaking changes
  name: AuditEventName;                // "Prompt.Purchased", "Contract.Upgraded", …
  occurredAt: string;                  // ISO-8601, observed off-chain
  actor: AuditActor;
  resource: AuditResource;
  correlation: AuditCorrelation;
  payload: P;                          // event-specific fields (redacted before sinks)
}
```

### Actor

```ts
interface AuditActor {
  stellarAddress?: string;   // on-chain signer (G… / C…)
  serviceId?: string;        // off-chain service, e.g. "indexer"
  adminRole?: string;        // human-readable label, e.g. "platform-admin"
}
```

Exactly one field is set.  `stellarAddress` is a **public key** (not personal
data) but is hashed in external log exports — see [Redaction rules](#redaction-rules).

### Resource

```ts
interface AuditResource {
  type: "prompt" | "bundle" | "access-pass" | "license" | "contract"
      | "voucher" | "listing" | "fee" | "dispute" | "payout";
  id?: string | number | bigint;   // absent for contract-wide events
}
```

### Correlation

```ts
interface AuditCorrelation {
  txHash?: string;         // Stellar transaction hash
  ledger?: number;         // ledger sequence
  traceId?: string;        // W3C Trace-Context traceparent
  idempotencyKey?: string; // caller-supplied idempotency key
}
```

---

## Event Names

Event names follow the convention `<Domain>.<Action>` in PascalCase and are
drawn from the finite `AuditEventName` union type.

| Domain | Events |
|--------|--------|
| Marketplace | `Prompt.Created` · `Prompt.Updated` · `Prompt.PriceUpdated` · `Prompt.SaleStatusUpdated` · `Prompt.AdminModerated` |
| Entitlements | `Prompt.Purchased` · `License.Transferred` · `Bundle.Created` · `Bundle.Purchased` · `AccessPass.Created` · `AccessPass.Purchased` |
| Settlement / fees | `Fee.Updated` · `Fee.WalletUpdated` · `PlatformFee.Updated` · `Payout.Released` · `Solvency.ViolationDetected` |
| Governance / admin | `Contract.PausedStateChanged` · `Contract.Upgraded` · `Admin.ActionTaken` |
| Vouchers | `Voucher.Added` · `Voucher.Removed` |
| Listings | `Listing.Extended` · `Listing.Revised` |
| Splits | `Splits.Updated` |
| Disputes | `Dispute.Opened` · `Dispute.Resolved` |

Adding a new name is non-breaking (consumers skip unknown names).
Renaming or removing a name is a **breaking change** — bump
`AUDIT_SCHEMA_VERSION`.

---

## Redaction Rules

Redaction is applied by `redactEvent()` before any event reaches a log sink,
analytics store, or external webhook.  The function returns a new object and
never mutates the input.

### REDACTED_FIELDS — excluded entirely

Fields in this set are replaced with the sentinel string `"[REDACTED]"`.
These are secret or high-sensitivity values whose presence in a log is a
security or privacy violation:

```
privateKey    secretKey        encryptedContent   ciphertext
rawBody       rawHeaders       rawXdr             password
apiKey        sessionToken     accessToken        refreshToken
voucherCode   contentHash      nin                taxId
bankAccount
```

The list is **append-only**: removing an entry is a breaking change because
consumers rely on the invariant holding forward.  Old events stored before an
entry was added may still contain the raw value; they should be treated as
pre-redaction-policy events and never re-exported without manual review.

### HASHED_FIELDS — SHA-256 hashed

Fields in this set are replaced with `sha256:<64-char hex>`.  The hash
preserves correlateability across events (same input → same hash) without
storing the raw value in external sinks:

```
stellarAddress   buyer   creator   seller   referrer
hashed_code      admin   new_fee_wallet
```

The hash function is SHA-256 (hex-encoded, lowercase), prefixed with
`"sha256:"` so a consumer can distinguish a hashed value from plaintext.

### Validation after redaction

`validateAuditEvent()` enforces that REDACTED_FIELDS keys are absent (or
hold only the sentinel) in the payload before the event is stored.  An event
that contains a raw secret in its payload fails validation and must be
quarantined.

---

## Schema Versioning

`AUDIT_SCHEMA_VERSION` (currently `1`) is the version of the envelope itself,
independent of the on-chain contract schema version (`CURRENT_EVENT_SCHEMA_VERSION`
in `events/schema.ts`).

### Versioning rules

| Change | Action |
|--------|--------|
| Add optional field to payload | No bump — consumers ignore unknown fields |
| Add required field to payload | **Bump** `AUDIT_SCHEMA_VERSION` |
| Rename or remove an envelope field | **Bump** |
| Rename or remove an `AuditEventName` | **Bump** |
| Add a new `AuditEventName` | No bump — consumers skip unknown names |

Every bump **must** add a row to `SCHEMA_MIGRATION_NOTES` in `types.ts` with:
- `fromVersion` / `toVersion`
- `breaking: true | false`
- `changes`: one-sentence description
- `migrationHint`: how to transform old → new (or `"no-op"`)

### Compatibility check

```ts
import { isCompatible, isFutureVersion } from "@prompthash/sdk";

// Before decoding an event from a queue or replay buffer:
if (!isCompatible(event.schemaVersion)) {
  if (isFutureVersion(event.schemaVersion)) {
    // From a newer deploy — quarantine for replay after upgrade.
    quarantine(event);
  } else {
    // From before this feature existed — dead-letter with an alert.
    deadLetter(event);
  }
  return;
}
```

---

## Retention and Migration Behavior

### Retention

Audit events (`AuditLog` class in the data-retention matrix) are retained
**permanently** — they are never eligible for automated cleanup.  See
[data-retention-policy.md](./data-retention-policy.md) for the full matrix.

Redacted fields must be stripped **before** the event is written to permanent
storage.  An audit log row that contains a raw secret is a compliance incident,
not a retention-policy question.

### Migration

When `AUDIT_SCHEMA_VERSION` is bumped, **old events on replay queues or in
database archives will carry the previous version number**.  The migration path
is:

1. Call `migrateEvent(event)` on the old event.  It applies each step in
   `SCHEMA_MIGRATION_NOTES` in order until the event reaches the current
   version.
2. Validate the migrated event with `validateAuditEvent`.
3. Proceed with the normal processing pipeline.

```ts
import { migrateEvent, validateAuditEvent } from "@prompthash/sdk";

const { event: current } = migrateEvent(storedEvent);
const result = validateAuditEvent(current);
if (!result.valid) {
  // Log and dead-letter; do not silently drop.
  deadLetter(storedEvent, result.errors);
  return;
}
process(result.event);
```

**No data is deleted during migration.**  `migrateEvent` transforms field
shapes in memory; it does not alter the stored row.  If the team decides to
back-fill stored events to the new shape, that is a separate migration script
and must be gated behind a dry-run run with per-row logging.

### Migration safety rules

1. **Never back-fill without a dry run.**  Run the migration with
   `DRY_RUN=true` and verify counts before writing.
2. **Never drop fields that may be needed for audits.**  If a field is removed
   from the schema, archive its value in a separate `legacy_fields` JSONB
   column, not `/dev/null`.
3. **Keep the previous schema version readable for at least one full release
   cycle** after the bump.  Remove support only after confirming no consumer
   is still on the old version.

---

## Usage Example

```ts
import {
  redactEvent,
  validateAuditEvent,
  type AuditEvent,
  AUDIT_SCHEMA_VERSION,
} from "@prompthash/sdk";

// 1. Build the event (before redaction).
const raw: AuditEvent = {
  schemaVersion: AUDIT_SCHEMA_VERSION,
  name: "Prompt.Purchased",
  occurredAt: new Date().toISOString(),
  actor: { stellarAddress: "GBUYER…" },
  resource: { type: "prompt", id: "42" },
  correlation: { txHash: "deadbeef…", ledger: 55_000_000 },
  payload: {
    prompt_id: 42n,
    price_stroops: 5_000_0000000n,
    buyer: "GBUYER…",    // will be hashed
    creator: "GCREATOR…", // will be hashed
    referrer: undefined,
  },
};

// 2. Redact before writing to any sink.
const safe = redactEvent(raw);

// 3. Validate (must pass before storage).
const validation = validateAuditEvent(safe);
if (!validation.valid) {
  throw new Error(`Audit event validation failed: ${validation.errors.join(", ")}`);
}

// 4. Store / emit.
await auditLog.insert(validation.event);
```

---

## Files

| Path | Purpose |
|------|---------|
| `packages/sdk/src/audit/types.ts` | Envelope types, event names, versioning constants, redaction rule sets, migration notes |
| `packages/sdk/src/audit/redact.ts` | `redactEvent`, `redactObject`, `sha256Hex` |
| `packages/sdk/src/audit/validate.ts` | `validateAuditEvent`, `isCompatible`, `isFutureVersion` |
| `packages/sdk/src/audit/compatibility.ts` | `migrateEvent`, `migrationPathSummary` |
| `packages/sdk/src/audit/index.ts` | Public re-exports |
| `packages/sdk/src/audit/validate.test.ts` | Schema validation and backward-compatibility tests |
| `packages/sdk/src/audit/redact.test.ts` | Redaction-rule tests |
