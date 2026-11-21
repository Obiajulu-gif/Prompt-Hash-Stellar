/**
 * Worst-case import load budgets (#1173).
 *
 * A bulk import is the heaviest caller-driven write path on the server: it
 * holds the request open, serializes an unbounded payload, then writes one
 * prompt and one provenance record per item. The endpoint already capped the
 * item count, but not the *bytes* — a single 100 MB string passed the count
 * check and was parsed, hashed and logged before anything rejected it.
 *
 * This module gives that path explicit, named ceilings so a hostile or
 * accidental worst-case payload is rejected before any parsing/writing work,
 * and so tightening a budget is an explicit, reviewable diff.
 *
 * Budgets are pre-flight only: they read the parsed request body and mutate
 * nothing. A rejected batch therefore has no partial state to roll back.
 */

/** Serialized-size ceilings (UTF-8 bytes of `JSON.stringify`). */
export const IMPORT_LOAD_BUDGETS = {
  /** Maximum items in one batch. Matches the endpoint's historical limit. */
  maxItems: 1_000,
  /** Maximum serialized size of an individual item. */
  maxRowBytes: 512 * 1024,
  /** Maximum serialized size of the whole batch. */
  maxBatchBytes: 8 * 1024 * 1024,
  /**
   * Worst-case planning budget for the pure import planner over a full batch
   * (no I/O). Used by the executable probe, not the HTTP path.
   */
  worstCasePlanMs: 2_500,
  /** Heap growth ceiling for the probe's worst-case batch. */
  maxHeapDeltaBytes: 256 * 1024 * 1024,
} as const;

export type ImportLoadViolationCode =
  | "batch_too_large"
  | "row_too_large"
  | "batch_bytes_exceeded"
  | "unserializable_row";

export interface ImportLoadViolation {
  code: ImportLoadViolationCode;
  message: string;
  remediation: string;
  rowIndex?: number;
}

export interface ImportLoadEvaluation {
  allowed: boolean;
  itemCount: number;
  totalBytes: number;
  largestRowBytes: number;
  limits: typeof IMPORT_LOAD_BUDGETS;
  violations: ImportLoadViolation[];
}

export class ImportLoadBudgetError extends Error {
  readonly status = 413;
  readonly code = "import_batch_exceeds_budget";

  constructor(readonly evaluation: ImportLoadEvaluation) {
    super(evaluation.violations[0]?.message ?? "Import batch exceeds its resource budget.");
    this.name = "ImportLoadBudgetError";
  }
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/**
 * Evaluate a parsed batch against the budgets without touching it.
 *
 * Every violation is reported (not just the first) so an operator can fix a
 * payload in one pass. `rowIndex` is zero-based and identifies the offending
 * item; the message never includes the item's content.
 */
export function evaluateImportLoadBudget(items: unknown[]): ImportLoadEvaluation {
  const violations: ImportLoadViolation[] = [];
  let totalBytes = 0;
  let largestRowBytes = 0;

  if (items.length > IMPORT_LOAD_BUDGETS.maxItems) {
    violations.push({
      code: "batch_too_large",
      message: `Batch has ${items.length} items; the maximum is ${IMPORT_LOAD_BUDGETS.maxItems}.`,
      remediation: `Split the import into batches of ${IMPORT_LOAD_BUDGETS.maxItems} items or fewer.`,
    });
  }

  items.forEach((item, rowIndex) => {
    let bytes: number;
    try {
      bytes = serializedBytes(item);
    } catch {
      violations.push({
        code: "unserializable_row",
        message: `Item at row ${rowIndex} cannot be serialized (circular or non-JSON value).`,
        remediation: "Send plain JSON values only; remove cycles, BigInts and functions.",
        rowIndex,
      });
      return;
    }

    totalBytes += bytes;
    largestRowBytes = Math.max(largestRowBytes, bytes);

    if (bytes > IMPORT_LOAD_BUDGETS.maxRowBytes) {
      violations.push({
        code: "row_too_large",
        message: `Item at row ${rowIndex} is ${bytes} bytes; the per-item maximum is ${IMPORT_LOAD_BUDGETS.maxRowBytes}.`,
        remediation: `Reduce this item below ${IMPORT_LOAD_BUDGETS.maxRowBytes} bytes (move large assets to a URL).`,
        rowIndex,
      });
    }
  });

  if (totalBytes > IMPORT_LOAD_BUDGETS.maxBatchBytes) {
    violations.push({
      code: "batch_bytes_exceeded",
      message: `Batch payload is ${totalBytes} bytes; the maximum is ${IMPORT_LOAD_BUDGETS.maxBatchBytes}.`,
      remediation: "Split the import into smaller batches or replace inline content with references.",
    });
  }

  return {
    allowed: violations.length === 0,
    itemCount: items.length,
    totalBytes,
    largestRowBytes,
    limits: IMPORT_LOAD_BUDGETS,
    violations,
  };
}

/** Throw the 413-shaped error when the batch is over budget. */
export function assertImportLoadBudget(items: unknown[]): ImportLoadEvaluation {
  const evaluation = evaluateImportLoadBudget(items);
  if (!evaluation.allowed) throw new ImportLoadBudgetError(evaluation);
  return evaluation;
}
