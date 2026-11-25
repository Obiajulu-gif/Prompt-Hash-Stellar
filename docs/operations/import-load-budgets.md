# Bulk Import Load Budgets and Worst-Case Probe (#1173)

Status: implemented in `server/src/services/importLoadBudget.ts`, enforced in
`server/src/controllers/bulkImportController.ts`, measured by
`server/scripts/importLoadProbe.ts`.

## Budgets

All ceilings are exported from `IMPORT_LOAD_BUDGETS` so changing one is a
reviewable diff rather than a scattered magic number.

| Budget | Limit | Enforced where |
| --- | --- | --- |
| `maxItems` | 1,000 items | Endpoint (existing 400 contract) and budget evaluator |
| `maxRowBytes` | 512 KiB serialized per item | Endpoint pre-flight (413) |
| `maxBatchBytes` | 8 MiB serialized per batch | Endpoint pre-flight (413) |
| `worstCasePlanMs` | 2,500 ms p95 | Executable probe only (not wall-clock in CI tests) |
| `maxHeapDeltaBytes` | 256 MiB | Executable probe only |

Serialized size is `Buffer.byteLength(JSON.stringify(item))`, i.e. the bytes the
server actually has to parse and hold. The messages never echo row content.

## Request ordering (security property)

`bulkImportPrompts` now runs, in order:

1. role check (`admin` / `maintainer`) → `403` before any payload work;
2. shape check (non-empty array, ≤ 1,000 items) → `400` (unchanged contract);
3. **resource budget** → `413` with `code`, `violations`, `limits`;
4. policy limits (`STORAGE_BULK_IMPORT`) → `429`;
5. transfer/idempotency record, then per-item writes.

An unauthorized caller cannot even trigger the budget scan, and an oversized
authenticated payload is rejected before a transfer record exists.

## Normal, failure, retry and authorization paths

- **Normal.** A batch inside every ceiling is evaluated, then proceeds to the
  existing policy and import flow unchanged.
- **Failure.** Over the row ceiling → `413 row_too_large` (with `rowIndex`);
  over the batch ceiling → `413 batch_bytes_exceeded`; over the item ceiling →
  `batch_too_large`; cyclic/JSON-hostile values → `unserializable_row` instead
  of a serialization crash. All violations are returned together.
- **Retry.** Budget evaluation is pure and deterministic and never mutates the
  caller's rows, so repeating a rejected request returns the same `413` body
  and never allocates a transfer id. This mirrors the import's existing
  retry model (idempotent per preview/import id).
- **Authorization.** `403` for non-admin/non-maintainer roles, evaluated
  before the budget; a denied caller leaves no transfer or audit write.
  Policy `429` remains distinct from budget `413` so clients can tell
  "slow down" from "shrink the payload".

## Edge cases

- **Boundary is inclusive.** Exactly 1,000 items and exactly `maxRowBytes` /
  `maxBatchBytes` are accepted; one unit over is rejected.
- **Batch bytes vs row bytes.** Many rows each under the row ceiling can still
  trip `batch_bytes_exceeded`; both checks are reported independently.
- **Unserializable values.** Circular structures and BigInts are reported as a
  violation rather than throwing out of the handler.
- **Repeated identical characters.** The import pipeline's unsafe-payload
  scanner quarantines low-entropy/oversized strings independently of these
  budgets; the probe therefore uses realistic prose under 4 KB per row so it
  measures accepted-row planning.
- **Dry runs.** Budget checks apply to dry runs too: a dry run still parses
  and holds the payload.

## Recovery and rollback

- Budgets are **pre-flight only**. A rejection means nothing was written, no
  transfer record exists, and there is nothing to roll back.
- Tightening a budget cannot retroactively fail an in-flight batch; it affects
  the next request only.
- Raising `maxRowBytes`/`maxBatchBytes` is an explicit code change reviewed
  against the probe and the endpoint's policy limits.

## Worst-case load test (executable)

```bash
cd server
npm run load:import
IMPORT_LOAD_ITERATIONS=25 IMPORT_LOAD_ROW_BYTES=3500 npm run load:import
```

The probe:

1. builds a full 1,000-row batch of realistic prose rows;
2. runs the same `evaluateImportLoadBudget` the endpoint runs and fails if the
   payload itself violates a budget;
3. warms up, then plans the batch `N` times through `previewPromptImport`
   (validation, normalization, hashing — no I/O);
4. reports p50/p95/max planning latency, payload bytes, heap growth and the
   budgets, and exits non-zero if p95 latency, heap growth, or accepted-row
   count exceeds its ceiling.

Automated coverage of the budgets and endpoint ordering lives in
`server/src/tests/importLoadBudget.test.ts` (boundaries, every violation class,
determinism/no-mutation, authorization-before-budget, retry-identical `413`).
The probe is intentionally not part of the unit suite: it measures wall-clock
and heap, which belong in an explicit load run rather than every test run.

```bash
cd server
npx vitest run src/tests/importLoadBudget.test.ts
npm run load:import
```
