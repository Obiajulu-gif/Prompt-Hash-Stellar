# Disaster Recovery & Domain Invariant Validation Runbook

_Issue #816 — Read-Only Post-Restore / Migration Invariant Checks, Violation Interpretation, and Escalation Steps_

## 1. Overview

Following a database restore from backup (or after a major database migration), maintainers must verify that core records, referential relationships, and on-chain settlement pointers are completely sound before opening traffic to write operations.

The Disaster Recovery Invariant Validation suite performs a 100% read-only scan against MongoDB to guarantee domain invariants are preserved.

---

## 2. Core Domain Invariants

| Invariant ID | Name | Severity | Scope & Integrity Rule |
|---|---|---|---|
| **INV_01** | **Prompt Record Integrity** | `CRITICAL` / `HIGH` | Non-empty `title`, valid `creatorAddress` / `seller`, non-negative `price`. |
| **INV_02** | **Purchase & Entitlement Referential Integrity** | `CRITICAL` / `HIGH` | Every `Purchase` and `Entitlement` must reference an existing prompt ID and valid buyer wallet address. No orphaned buyer rights. |
| **INV_03** | **Payout Ledger & Settlement Integrity** | `CRITICAL` / `HIGH` | Ledger entries must reference valid creators and non-negative amounts. |
| **INV_04** | **Bundle Composition Invariants** | `CRITICAL` / `HIGH` | Bundles must reference at least one existing prompt and have positive bundle price. |
| **INV_05** | **Transaction Reference Uniqueness** | `CRITICAL` | Single on-chain transaction hash cannot be claimed across multiple purchase records (replay / collision guard). |
| **INV_06** | **Auxiliary & Orphaned Record Detection** | `HIGH` / `WARNING` | Indexer state cursor must be present; reviews must link to existing prompt records. |

---

## 3. Running Validation Checks

### CLI Execution
Run the invariant scanner after restore completes:

```bash
# Standard console report
npx ts-node server/scripts/validateRestoreInvariants.ts

# Strict mode (fails on warnings as well as criticals)
npx ts-node server/scripts/validateRestoreInvariants.ts --strict

# Machine-readable JSON output for automated CI / restore pipelines
npx ts-node server/scripts/validateRestoreInvariants.ts --json
```

**Expected Healthy Output**:
```
==================================================================
  PROMPT HASH STELLAR - DISASTER RECOVERY INVARIANT VALIDATION
  Timestamp: 2026-09-27T02:00:00.000Z
  Overall Status: [ PASSED ]
==================================================================

SUMMARY:
  • Invariants Evaluated:   6
  • Critical Violations:    0
  • High Violations:        0
  • Warning Violations:     0
------------------------------------------------------------------
[ PASS ] INV_01: Prompt Record Integrity
[ PASS ] INV_02: Purchase & Entitlement Referential Integrity
[ PASS ] INV_03: Payout Ledger & Settlement Integrity
[ PASS ] INV_04: Bundle Composition & Pricing Invariants
[ PASS ] INV_05: On-Chain Transaction Reference Uniqueness
[ PASS ] INV_06: Auxiliary & Orphaned Record Detection
==================================================================
[✓] All core domain invariants verified. Database is ready for traffic.
```

### API Endpoint (Requires `dr:read` admin scope)
- **`GET /api/admin/dr/validate-invariants`**

---

## 4. Failure Escalation & Incident Triage

If the validation check exits with non-zero exit code:

1. **Halt Traffic**: Do NOT point DNS or enable traffic to the restored MongoDB instance.
2. **Review Violations**:
   - `CRITICAL` (Orphaned purchases, duplicate tx hashes, broken prompts): Indicates data loss or corrupted backup manifest. Re-run restore from a previous known clean timestamp or execute Soroban On-Chain Replay via `npm run reindex`.
   - `HIGH` (Negative prices, missing buyer references): Run database repair scripts to remediate dangling metadata.
   - `WARNING` (Orphaned reviews): Review log files and clean orphaned non-financial records.
3. **Re-run Invariant Scanner**: Confirm exit code `0` before signing off on database recovery.
