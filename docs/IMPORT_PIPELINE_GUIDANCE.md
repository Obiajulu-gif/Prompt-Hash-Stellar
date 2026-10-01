# Prompt Import Pipeline & Dry-Run Validation Guidance

This document describes the bulk import pipeline specifications, dry-run safety guarantees, idempotency handling, and failure remediation procedures for **Prompt Hash Stellar**.

---

## 1. Import Format & Validation Rules

Bulk import payloads accept arrays of prompt objects (`PromptImportRow`).

### Required Fields
- `creatorWallet`: Stellar wallet address of the prompt author (e.g., `G...`).
- `externalId` or `payloadRef`: Unique identifier used for catalog lookup or deterministic deduplication.
- `title`, `category`, `price`: Standard metadata compliant with `PromptMetadata`.

---

## 2. Dry-Run Execution & Safety Guarantees

By default, import evaluations execute in **Dry-Run mode** (`dryRun: true`):
- **Zero Persistent Writes:** No changes are committed to storage or indexing layers during a dry-run execution.
- **In-Memory Validation:** Evaluates validity, duplicates, and schema compliance without side effects.
- **Execution Breakdown:** Returns structured statistics:
  ```json
  {
    "dryRun": true,
    "committed": false,
    "counts": {
      "total": 3,
      "created": 1,
      "updated": 1,
      "skipped": 0,
      "invalid": 1
    }
  }
  ```

---

## 3. Idempotency & Ownership Safeguards

- **External ID Lookup:** If `externalId` matches an existing catalog record owned by the same `creatorWallet`, the action is recorded as updated rather than duplicate creation.
- **Creator Protection:** If an import row attempts to update an `externalId` owned by a different wallet address, the row is rejected as invalid with an ownership mismatch error.

---

## 4. Remediation & Partial Failure Recovery

When an import payload contains invalid rows:
1. Inspect the `remediationGuidance` array in the execution report.
2. Fix indicated row numbers and resubmit.
3. Re-running the import after partial fixes is safe; existing `externalId` references ensure previously succeeded rows are idempotently updated or skipped rather than duplicated.
