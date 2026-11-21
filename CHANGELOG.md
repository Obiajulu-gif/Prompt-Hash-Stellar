# Changelog

All notable changes to PromptHash Stellar will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Dependency-aware public health on the status page (#1179)
- The `/status` page now renders dependency-aware readiness from
  `GET /api/health`: one row per dependency with status, criticality, latency
  and a redacted reason code, plus the overall `ok`/`degraded`/`down` state.
- The panel honours `Retry-After` (bounded to 0–60 s), retries automatically
  during an outage, offers a manual refresh, and degrades safely on network
  errors, malformed bodies, and older deployments that do not report
  dependency detail. Raw server detail is never rendered.
- Coverage: `src/test/health/dependencyHealth.test.ts` and
  `src/test/components/DependencyHealthPanel.test.tsx` (normal, failure,
  retry, redaction/authorization, legacy and malformed paths). See
  `docs/operations/public-health-endpoint.md`.

#### Risk, permission review, API errors, and release evidence (Issues #1188, #1189, #1198, #1199)
- High-risk action assessments now explain the score calculation and include each fired signal's rationale in their summary.
- Permission previews expose both sides of a role transition; missing and stale review digests carry stable `PERMISSION_DIFF_REQUIRED` and `STALE_PERMISSION_DIFF` API codes.
- High-risk release checks now require linked recovery procedure and verification evidence, with the existing incident-ticket waiver path.
- Added contract tests for recovery evidence enforcement, score explanations, and stable permission review error codes.

#### Replay, snapshot, dispute and session hardening (Issues #905, #906, #907, #908)
- Replay validation (#905): journal rows are shape-checked before reducers run.
  Malformed rows stop strict runs and are counted and sampled in lenient runs,
  and block activation. Reducer errors and a checkpoint event that has left the
  journal stop the run with the event named. See `docs/operations/event-replay.md`.
- Snapshot validation (#906): read-only `npm run backup:validate` checks a local
  backup for checksum and size mismatches, missing or unexpected records,
  malformed lines, duplicate keys, orphaned references and inconsistent indexer
  state. See `docs/operations/backup-and-recovery.md`.
- Ownership transfer disputes (#907): either party can dispute an approved
  transfer within 14 days. An open dispute holds the listing (new transfer
  requests get `423`). Maintainers accept (listing reverted) or reject. All
  transitions are audited. See `docs/operations/ownership-transfer-disputes.md`.
- Security event session policy (#908): credential, role and recovery changes,
  and logout-all, end the account's earlier sessions. Revoked sessions get a
  user-safe message, and the internal reason is no longer returned to clients.
  See `docs/operations/stale-session-revocation.md`.

#### Admin governance controls (Issues #909, #910, #911, #912)
- Schema-driven config validation (#909): feature-flag PATCH bodies are checked
  against `FEATURE_FLAG_UPDATE_SCHEMA` before any write, returning 400 with field
  issues. `POST /api/flags/:name/preview` returns the field-level diff and a
  rollback patch without writing. See `docs/operations/admin-config-audit.md`.
- Permission-aware bulk action framework (#910): explicit selections with
  expected versions, dry-run planning with per-record codes, a confirmation token
  bound to the eligible set, and single-use execution. Not yet wired to a route.
  See `docs/operations/bulk-actions.md`.
- Redaction profiles for audit exports (#911): `purpose` selects `full`,
  `investigation`, or `external_share` from the caller's scopes. Export schema v2
  adds `schemaVersion`, `redactionProfile`, and verification metadata. See
  `docs/operations/audit-log-usage.md`.
- Time-boxed maintainer access grants (#912): approver-issued grants with scope,
  reason, and expiry; no self-approval; expiry enforced per request; issuance and
  use audited; active/expired report and revocation. See
  `docs/operations/maintainer-access-grants.md`.

#### Reliability and evidence hardening (Issues #1008, #1009, #1010, #1011)
- Deterministic replay verification (#1008): a pure replay fold that orders
  events by `(ledger, eventId)`, collapses retries, rejects conflicting event
  ids, skips already-persisted stale rows, and verifies journal/reverse/
  seeded-shuffle/retry-storm histories produce one projection fingerprint.
  See `docs/operations/deterministic-replay.md`.
- Queue backpressure (#1009): per-type admission ceilings over pending +
  processing jobs, env overrides, idempotent retry bypass, `429` +
  `Retry-After`, and `GET /api/jobs/pressure`. Settlement and repairs keep
  generous ceilings; exports and analytics are tighter. See
  `docs/operations/queue-backpressure.md`.
- Prompt schema migration compatibility gate (#1010): a read-only checker and
  `npm run schema:compat` CLI that build v3 candidates, block ambiguous
  `price` conversions and alias conflicts, and emit deterministic fingerprints
  plus migration/rollback plans. See
  `docs/operations/schema-migration-compatibility.md`.
- External evidence verification (#1011): Ed25519 envelopes with a trusted-key
  registry, payload-hash and timestamp checks, issuer/scope authorization,
  idempotent `evidenceId` retries, nonce-reuse and conflict detection,
  Mongo-backed replay storage, and admin-scoped import/read routes. See
  `docs/operations/external-evidence-verification.md`.

#### Operational hardening (Issues #1024, #1025, #1026, #1027)
- Versioned event replay (#1024): an append-only `EventJournal` written by the
  indexer, a replay engine that rebuilds projections into isolated,
  resumable runs with event-schema version gating, activation/rollback via a
  projection pointer, admin routes under `/api/admin/projections`, and a
  `projections:replay` CLI with chain backfill. See
  `docs/operations/event-replay.md`.
- Strict allow-list validation (#1025) for webhook destinations, listing
  image URLs and report evidence URLs, plus extension/MIME/magic-byte file
  type checks, with `ALLOWLIST_MODE=report` as a rollback lever. See
  `docs/operations/allow-list-validation.md`.
- Audit evidence for admin configuration changes (#1026): feature flag
  create/update/delete write `admin_config_change` records with before/after
  state, or are rolled back when evidence cannot be recorded; queryable at
  `GET /api/audit/config-changes`. See `docs/operations/admin-config-audit.md`.
- Dependency-aware public health (#1027): `/api/health`, `/api/health/live`
  and admin `/api/health/details` with timeouts, retry, caching and redacted
  public output. See `docs/operations/public-health-endpoint.md`.
- Fixed: the indexer referenced an undefined `getEventDecoder`, so every
  event was quarantined as `decoder_error`; and `admin_maintenance_change`
  audit records were rejected by the `AuditLog` schema enum.

#### Prompt Lifecycle State Machine (Issue #786)
- New explicit lifecycle states — `draft`, `review`, `published`, `hidden`,
  `suspended`, `archived` — replacing scattered `listingStatus`/
  `moderationStatus`/`isActive` checks. See `docs/prompt-lifecycle.md`.
- `packages/schema/src/lifecycle.ts`: pure, framework-free transition
  table (`canTransition`/`assertTransition`/`availableTransitions`) and a
  legacy-field migration function (`deriveLifecycleState`).
- `server/src/services/promptLifecycle.ts`: the single write path for
  lifecycle transitions — validates against the transition table, updates
  the prompt document, and records an audit event either way.
- `api/prompts/moderate.ts` now routes through the lifecycle state
  machine instead of writing status fields directly, and rejects
  moderation actions invalid for the listing's current state (`409
  INVALID_STATE`).
- Fixed: `moderationStatus`/`moderatedAt`/`moderatedBy`/`moderationReason`/
  `moderationNotes` were referenced by the moderation endpoint but never
  declared on the `Prompt` schema, so every write to them was silently
  dropped by Mongoose's default strict mode. They're now declared fields.

#### Payout Readiness Validation System
- **New requirement**: Creators must complete payout readiness validation before publishing paid prompts
- **4-step validation system**:
  1. Wallet Connection - Valid Stellar address connected
  2. Payout Destination - Configured address where earnings will be sent  
  3. Creator Profile - Complete profile with display name and bio (required)
  4. Settlement Readiness - Sufficient XLM balance for transaction fees (≥2.0 XLM)
- **Interactive UI components**:
  - `PayoutReadinessBanner` - Compact status display with quick actions
  - `PayoutReadinessChecklist` - Detailed interactive checklist with progress tracking
  - `PayoutReadinessPage` - Dedicated page for payout setup management
- **Enhanced CreatePromptForm**:
  - Real-time validation status display
  - Form submission blocking when setup incomplete
  - Actionable error messages with direct fix links
  - Preserved draft functionality during setup completion
- **Enhanced PayoutSettingsPage**:
  - Real-time payout address validation
  - Visual feedback with color-coded status indicators
  - Integration with readiness status display
  - Disabled save button for invalid configurations
- **New API functions**:
  - `validatePayoutReadiness()` - Core validation logic
  - `checkCreatorPayoutReadiness()` - Convenience wrapper
  - `usePayoutReadiness()` - React hook for state management
  - `usePayoutReadinessGate()` - Simplified hook for blocking checks
- **Comprehensive test coverage**:
  - Unit tests for validation logic with edge cases
  - React hook tests with mocked dependencies  
  - Component integration tests for UI interactions
  - End-to-end CreatePromptForm integration tests

### Changed
- **Creator onboarding flow**: Now requires profile completion and payout configuration before paid prompt publication
- **Documentation updates**: Updated creator-onboarding.md with new validation requirements and troubleshooting
- **Error handling**: Enhanced error messages throughout the flow with specific, actionable guidance

### Technical Details
- **Validation runs client-side** for immediate feedback
- **Real-time updates** when wallet balance or configuration changes
- **Graceful degradation** when validation services are unavailable
- **Preserves existing workflows** for draft saving and free prompts (if supported)
- **No breaking changes** to existing creator accounts - validation applies to new publications only

### Developer Impact
- New validation system integrates seamlessly with existing forms
- Comprehensive TypeScript interfaces for type safety
- Extensive test suite covers all acceptance criteria scenarios
- Clear separation of concerns between validation logic and UI components
- Detailed API documentation for integration guidance

---

*Previous changelog entries would go below this section*
