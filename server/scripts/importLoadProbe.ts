/**
 * Executable worst-case load probe for the bulk import path (#1173).
 *
 * Builds a maximum-size batch, runs the same pure budget check the HTTP
 * endpoint runs, then plans it through `previewPromptImport` (the same
 * validation/normalization/hash work a real preview does, without any I/O).
 * It reports p50/p95 planning latency, payload bytes and heap growth against
 * the named budgets in `services/importLoadBudget.ts`.
 *
 * Usage:
 *   npm run load:import
 *   IMPORT_LOAD_ITERATIONS=25 npm run load:import
 *
 * Exit code 0 = within budget, 1 = a budget was exceeded.
 */

import {
  evaluateImportLoadBudget,
  IMPORT_LOAD_BUDGETS,
} from "../src/services/importLoadBudget";
import { previewPromptImport } from "../src/services/promptImportPipeline";
import type { PromptImportRow } from "../src/services/promptImport";

const ITERATIONS = Math.max(1, Number(process.env.IMPORT_LOAD_ITERATIONS) || 15);
const ROW_CONTENT_BYTES = Math.max(
  1,
  // 3.5 KB keeps every row inside the pipeline's own 4 KB unsafe-payload
  // truncation bound, so the probe measures planning of accepted rows.
  Number(process.env.IMPORT_LOAD_ROW_BYTES) || 3_500,
);

function worstCaseRows(): PromptImportRow[] {
  // Realistic prose, not one repeated character: the unsafe-payload scanner
  // quarantines low-entropy blobs, which would make the probe measure
  // quarantine throughput instead of import planning.
  const prose =
    "Write a clear and detailed prompt that explains the task, lists the constraints, and shows the expected output format. ";
  const content = prose.repeat(Math.ceil(ROW_CONTENT_BYTES / prose.length)).slice(0, ROW_CONTENT_BYTES);
  return Array.from({ length: IMPORT_LOAD_BUDGETS.maxItems }, (_, index) => ({
    externalId: `load-probe-${index}`,
    creatorWallet: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    title: `Worst case prompt ${index}`,
    content,
    category: "Programming",
    image: "https://example.com/p.png",
    price: 1,
    tags: ["load", "probe"],
  })) as PromptImportRow[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

const rows = worstCaseRows();

// Pre-flight budget: exactly what the endpoint enforces.
const budget = evaluateImportLoadBudget(rows);
if (!budget.allowed) {
  console.error("Worst-case batch violates the import budget:");
  for (const violation of budget.violations) console.error(` - ${violation.message}`);
  process.exit(1);
}

// Warm-up (JIT + module-level regex/schema caches) before measuring.
previewPromptImport(rows);

const durations: number[] = [];
const heapBefore = process.memoryUsage().heapUsed;
let planned = 0;

for (let iteration = 0; iteration < ITERATIONS; iteration++) {
  const started = process.hrtime.bigint();
  const preview = previewPromptImport(rows);
  durations.push(Number(process.hrtime.bigint() - started) / 1_000_000);
  planned = preview.counts.create + preview.counts.update;
}

const heapDelta = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
const sorted = [...durations].sort((a, b) => a - b);
const p50 = percentile(sorted, 50);
const p95 = percentile(sorted, 95);
const max = sorted[sorted.length - 1];

const failures: string[] = [];
if (planned !== rows.length) {
  failures.push(`planner accepted ${planned}/${rows.length} rows`);
}
if (p95 > IMPORT_LOAD_BUDGETS.worstCasePlanMs) {
  failures.push(
    `p95 plan time ${p95.toFixed(1)}ms exceeds ${IMPORT_LOAD_BUDGETS.worstCasePlanMs}ms`,
  );
}
if (heapDelta > IMPORT_LOAD_BUDGETS.maxHeapDeltaBytes) {
  failures.push(
    `heap growth ${mb(heapDelta)} exceeds ${mb(IMPORT_LOAD_BUDGETS.maxHeapDeltaBytes)}`,
  );
}

const report = {
  workload: "bulk-import worst case",
  iterations: ITERATIONS,
  rows: rows.length,
  acceptedRows: planned,
  payloadBytes: budget.totalBytes,
  payload: mb(budget.totalBytes),
  largestRowBytes: budget.largestRowBytes,
  planMs: {
    p50: Number(p50.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    max: Number(max.toFixed(2)),
    budget: IMPORT_LOAD_BUDGETS.worstCasePlanMs,
  },
  heapDeltaBytes: heapDelta,
  budgets: IMPORT_LOAD_BUDGETS,
  passed: failures.length === 0,
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  console.error(`\nLoad probe FAILED:\n - ${failures.join("\n - ")}`);
  process.exit(1);
}
console.log(`\nLoad probe passed (${ITERATIONS} iterations, ${rows.length} rows).`);
