# Release Readiness Checklist — Prompt Hash Stellar

> **Purpose**: Ensure high-risk changes pass consistent readiness criteria before merging to `main` or deploying to production.
>
> **Audience**: Contributors, reviewers, and maintainers.
>
> **Applies to**: Contract upgrades, schema migrations, auth/wallet flow changes, payout/settlement logic, marketplace API mutations, and any change touching user funds or access control.

---

## What Counts as a High-Risk Change?

A change is high-risk if it affects any of the following:

| Area | Examples |
|------|---------|
| **Smart contract** | Any `contracts/prompt-hash/` or `contracts/revenue-rounding/` change |
| **Database migration** | New migration in `server/src/db/migrations/` |
| **Auth / wallet** | `api/auth/`, `src/lib/auth/`, challenge/verify flow |
| **Payout / settlement** | `LedgerEntry`, `PayoutLedger`, settlement jobs |
| **Fulfillment / unlock** | `api/prompts/unlock.ts`, `fulfillmentRouter` |
| **Indexer** | `server/src/services/indexer.ts`, `IndexerState` model |
| **Admin operations** | RBAC, admin token scopes, impersonation guards |
| **Encryption keys** | `unlockPublicKey`, challenge secret, libsodium wrappers |
| **Config / env** | New required environment variables |

If you are unsure, treat the change as high-risk and run the full checklist.

---

## Checklist Template

Copy this block into your pull request description and check each item before requesting review.

```markdown
## Release Readiness Checklist

### Tests
- [ ] All existing tests pass locally (`yarn test`, `cargo test --all`, `yarn test:e2e`)
- [ ] New unit/integration tests cover the happy path and at least one failure mode
- [ ] Any concurrency-sensitive mutation path has a test that verifies invariants under concurrent load
- [ ] Contract changes: ABI conformance tests regenerated (`npx tsx tests/abi-conformance/scripts/generate-fixtures.ts`) and committed

### Documentation
- [ ] Public-facing API changes are reflected in `docs/openapi.json`
- [ ] Architecture or data-flow changes update the relevant `docs/` file
- [ ] New environment variables are documented in `.env.example` and `docs/environments.md`
- [ ] Breaking changes call out the migration path in the PR description

### Migration
- [ ] Schema migrations have been dry-run locally: `node scripts/migration-safety.mjs --dry-run`
- [ ] Migration post-validation passes: `node scripts/migration-safety.mjs --verify`
- [ ] No irreversible data transforms without a matching rollback procedure documented in the PR

### Configuration
- [ ] New required env vars are listed in `.env.example` with a safe default or clear placeholder
- [ ] Feature-flag guard added for gradual rollout if the change is large or risky
- [ ] Secrets rotation not required, OR rotation runbook referenced (`docs/secret-rotation.md`)

### Rollback
- [ ] A rollback plan is described in the PR (feature flag disable, migration rollback command, or revert tag)
- [ ] Contract upgrade: `scripts/preflight_upgrade.py check` passes and upgrade strategy is documented
- [ ] Data migrations: rollback command tested: `yarn --cwd server db:rollback`

### Maintainer Sign-Off
- [ ] At least one maintainer has reviewed and approved
- [ ] For contract changes or payout-path changes: two maintainer approvals required
- [ ] CI gate passes (all jobs green in `.github/workflows/ci.yml`)
```

---

## Automated Checks

The following checks run automatically in CI and must be green before merge. They serve as the automated layer of this checklist.

### Always-on (every PR to `main`)

| Check | Workflow | What it validates |
|-------|----------|-------------------|
| `cargo fmt --all -- --check` | `ci.yml` / `contracts.yml` | Rust formatting |
| `cargo clippy … -D warnings` | `ci.yml` / `contracts.yml` | Rust lint, no warnings |
| `cargo test --all` | `ci.yml` / `contracts.yml` | Contract unit tests |
| `yarn typecheck` | `ci.yml` / `frontend.yml` | TypeScript compile |
| `yarn lint` | `ci.yml` / `frontend.yml` | ESLint |
| `yarn test:frontend` | `ci.yml` / `frontend.yml` | Frontend Vitest suite |
| `npm test` (server) | `ci.yml` / `backend.yml` | Server Vitest suite |
| `yarn check:policy` | `ci.yml` | Production build rules |
| OpenAPI schema drift | `openapi.yml` | Route/schema parity |
| Merge conflict markers | `hygiene.yml` | No leftover conflict markers |

### Path-triggered

| Trigger path | Extra check | Workflow |
|--------------|------------|----------|
| `contracts/**` | ABI conformance fixtures regenerated and committed | `contracts.yml` |
| `contracts/**` | Upgrade preflight self-check (`scripts/preflight_upgrade.py`) | `contracts.yml` |
| `contracts/**` | TTL renewal readiness (`scripts/check-ttl-readiness.mjs`) | `contracts.yml` |

### Running checks locally before pushing

```bash
# Full CI simulation (fast path — no WASM build)
yarn typecheck && yarn lint && yarn test:frontend
npm --prefix server test
cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test --all

# Migration safety
node scripts/migration-safety.mjs --dry-run --migration=<migration-name>

# ABI conformance (after any contract change)
npx tsx tests/abi-conformance/scripts/generate-fixtures.ts
npm test -- tests/abi-conformance/validators/

# Policy lint
yarn check:policy

# Smoke verification (requires running server)
yarn verify:smoke
```

---

## Exception Handling for Urgent Fixes

Some production incidents require merging without the full checklist. Use the following exception process.

### When an exception is permitted

- Active P1 incident with confirmed user impact (data loss, funds at risk, full service outage)
- Security patch with a CVE or active exploit
- Regulatory requirement with a hard deadline

### Exception process

1. **Declare the exception** in the PR description:
   ```
   ## Exception: Urgent Fix
   Reason: [P1 incident / CVE / regulatory]
   Incident ticket: [link]
   Skipped items: [list checklist items being skipped]
   Follow-up issue: [link to issue for deferred work]
   ```

2. **Minimum bar that cannot be skipped** regardless of urgency:
   - At least one maintainer approval
   - CI gate passes (or individual failing job is documented as unrelated)
   - No migration in the PR unless it is the fix itself and a rollback plan is written inline

3. **Within 48 hours of merge**, open a follow-up issue to complete skipped items and run a post-incident review.

4. **Post-incident**: Update `docs/INCIDENT_RUNBOOK.md` if the gap that caused the incident was a missing runbook step.

---

## Maintainer Sign-Off Expectations

### Standard changes (1 approval)

Any change not in the high-risk categories listed above. CI must be green. The reviewing maintainer checks:
- Tests cover new behavior
- Docs are updated
- No new env vars introduced silently

### High-risk changes (1 maintainer approval + checklist complete)

Changes in the high-risk categories above. The approving maintainer verifies every checklist item is checked or has a documented exception.

### Contract or payout changes (2 maintainer approvals)

Any change to `contracts/`, `server/src/services/payoutLedger*`, `server/src/jobs/settlementPoll*`, or `api/prompts/unlock.ts`. Two separate maintainer approvals are required. Both approvers should independently verify:
- The migration/upgrade is reversible or has a tested rollback
- No funds can be double-spent or permanently locked by the change
- ABI conformance tests pass

### Emergency merge (1 approval + exception declaration)

See the exception process above. A follow-up issue is mandatory.

---

## PR Template Integration

The checklist above is embedded in `.github/pull_request_template.md` under the `## Release Readiness` section so it auto-populates for every new PR.

---

## References

- Rollback procedures: [`docs/INCIDENT_RUNBOOK.md`](./INCIDENT_RUNBOOK.md) § Full Rollback
- Migration safety: [`docs/MIGRATION_SAFETY.md`](./MIGRATION_SAFETY.md)
- Secret rotation: [`docs/secret-rotation.md`](./secret-rotation.md)
- Environment variables: [`docs/environments.md`](./environments.md)
- Contract upgrade preflight: `scripts/preflight_upgrade.py`
- ABI conformance: `tests/abi-conformance/`
