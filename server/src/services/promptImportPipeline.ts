/**
 * Secure import pipeline (#secure-import).
 *
 * A thin, fully testable layer on top of `planPromptImport` that turns the
 * existing dry-run planner into a preview → commit → rollback workflow:
 *
 *   preview  — validates rows, produces a deterministic `previewId` bound to
 *              the exact input, and quarantines unsafe rows with stable
 *              reason codes. Preview never writes to a store and never
 *              echoes raw payload references (only hashed `rowRef`s).
 *   commit   — refuses to run unless the supplied `previewId` matches a fresh
 *              re-plan of the same input, then applies rows through an
 *              `ImportStore`. Every accepted row is traceable (importId +
 *              rowRef), and writes are idempotent per `importId` so a crashed
 *              or retried commit converges to the same receipt.
 *   rollback — reverses the most recent commit: rows created by the import
 *              are deleted, rows updated by it are restored from the snapshot
 *              stored at commit time. Superseded rows (a later import touched
 *              them) are skipped and reported instead of clobbered.
 *
 * The store interface keeps this pure logic free of Mongoose; production
 * callers adapt a Mongo-backed store, tests use `createMemoryImportStore`.
 */

import { createHash } from "node:crypto";
import {
  planPromptImport,
  type ImportExisting,
  type PromptImportRow,
} from "./promptImport";
import { redactSensitiveFields } from "./sensitiveContent";
import {
  createImportAttestation,
  type ImportAttestation as CryptographicAttestation,
  type ProvenanceSigner,
} from "./importProvenance";

export type QuarantineReasonCode =
  | "missing_identity"
  | "missing_creator"
  | "invalid_metadata"
  | "duplicate_row"
  | "ownership_mismatch"
  | "unsafe_payload";

export interface QuarantinedRow {
  rowRef: string;
  externalId?: string;
  reasonCodes: QuarantineReasonCode[];
}

export interface PreviewRowRef {
  rowRef: string;
  externalId?: string;
}

export interface ImportPreview {
  previewId: string;
  createdAt: string;
  counts: { create: number; update: number; quarantine: number };
  create: PreviewRowRef[];
  update: PreviewRowRef[];
  quarantined: QuarantinedRow[];
}

export interface StoredImportedPrompt {
  externalId: string;
  creatorWallet: string;
  /** Deterministic import identity; repeated commits reuse it. */
  importId: string;
  rowRef: string;
  origin: "created" | "updated";
  /** Snapshot before this import wrote the row, for rollback. */
  previousRecord: StoredImportedPrompt | null;
  row: PromptImportRow;
}

export interface ImportStore {
  listExisting(): Promise<ImportExisting[]>;
  get(externalId: string): Promise<StoredImportedPrompt | undefined>;
  put(record: StoredImportedPrompt): Promise<void>;
  delete(externalId: string): Promise<void>;
}

export interface ImportReceiptRow {
  action: "created" | "updated";
  externalId?: string;
  rowRef: string;
  importId: string;
}

export interface ImportReceipt {
  importId: string;
  previewId: string;
  committedAt: string;
  receiptHash: string;
  rows: ImportReceiptRow[];
  quarantined: QuarantinedRow[];
  /**
   * Present only when the caller supplies a signing key (#1206). Its absence
   * preserves the original receipt contract for unsigned imports.
   */
  attestation?: CryptographicAttestation;
}

export interface RollbackReport {
  importId: string;
  rolledBackAt: string;
  reverted: number;
  skipped: Array<{
    externalId: string;
    reason: "missing" | "superseded" | "missing_snapshot";
  }>;
}

export class ImportPreviewMismatchError extends Error {
  constructor() {
    super(
      "Import commit refused: the provided previewId does not match the supplied rows (input changed after preview). Re-run preview.",
    );
    this.name = "ImportPreviewMismatchError";
  }
}

/** Map `planPromptImport` error strings to stable, machine-readable codes. */
function toReasonCode(error: string): QuarantineReasonCode {
  if (error.includes("externalId or payloadRef")) return "missing_identity";
  if (error.includes("creatorWallet")) return "missing_creator";
  if (error.includes("invalid prompt metadata")) return "invalid_metadata";
  if (error.includes("duplicate row")) return "duplicate_row";
  if (error.includes("ownership")) return "ownership_mismatch";
  return "invalid_metadata";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Stable, non-reversible row reference. Derived from identity fields only, so
 * it never carries the raw `payloadRef` and stays stable across preview and
 * commit.
 */
export function computeRowRef(row: PromptImportRow): string {
  return `row_${sha256(
    JSON.stringify({
      externalId: row.externalId ?? null,
      payloadRef: row.payloadRef ?? null,
      creatorWallet: row.creatorWallet ?? null,
    }),
  ).slice(0, 32)}`;
}

/**
 * True when a row carries deny-listed content (secrets, keys, plaintext,
 * ciphertext) or oversized fields. Such rows never reach the store; they are
 * quarantined with `unsafe_payload`.
 */
export function containsUnsafeContent(row: PromptImportRow): boolean {
  return JSON.stringify(redactSensitiveFields(row)) !== JSON.stringify(row);
}

/**
 * Validate and plan an import without any mutation. The returned
 * `previewId` is a deterministic hash of the input rows — commit refuses to
 * run unless it matches — while the create/update/quarantine split reflects
 * the `existing` records supplied at preview time.
 */
export function previewPromptImport(
  rows: PromptImportRow[],
  existing: ImportExisting[] = [],
  now: Date = new Date(),
): ImportPreview {
  const report = planPromptImport(rows, existing);

  const quarantineFromInvalid: QuarantinedRow[] = report.invalid.map(
    (entry) => ({
      rowRef: computeRowRef(entry.row),
      externalId: entry.row.externalId,
      reasonCodes: Array.from(new Set(entry.errors.map(toReasonCode))),
    }),
  );

  const createdRefs: PreviewRowRef[] = [];
  const updatedRefs: PreviewRowRef[] = [];
  const unsafe: QuarantinedRow[] = [];

  for (const planned of planRowsInInputOrder(rows, report)) {
    const ref = computeRowRef(planned.identity);
    if (containsUnsafeContent(planned.row)) {
      unsafe.push({
        rowRef: ref,
        externalId: planned.row.externalId,
        reasonCodes: ["unsafe_payload"],
      });
      continue;
    }
    const target = planned.action === "create" ? createdRefs : updatedRefs;
    target.push({ rowRef: ref, externalId: planned.row.externalId });
  }

  const quarantined = [...quarantineFromInvalid, ...unsafe];

  // The preview id binds to the exact *input rows* only. Store state is
  // deliberately excluded: it is re-validated at commit time (ownership,
  // duplicates), and excluding it keeps `previewId` stable across retries so
  // commit stays idempotent after a partial or repeated run.
  const previewId = `prev_${sha256(JSON.stringify({ rows })).slice(0, 40)}`;

  return {
    previewId,
    createdAt: now.toISOString(),
    counts: {
      create: createdRefs.length,
      update: updatedRefs.length,
      quarantine: quarantined.length,
    },
    create: createdRefs,
    update: updatedRefs,
    quarantined,
  };
}

function canonicalReceipt(input: {
  importId: string;
  previewId: string;
  rows: ImportReceiptRow[];
  quarantined: QuarantinedRow[];
}): string {
  return JSON.stringify({
    importId: input.importId,
    previewId: input.previewId,
    rows: input.rows,
    quarantined: input.quarantined,
  });
}

interface PlannedRow {
  /** Sanitized row from the planner (no raw `payloadRef`), used for storage. */
  row: PromptImportRow;
  /** The caller's row, used for the stable `rowRef` identity. */
  identity: PromptImportRow;
  action: "create" | "update";
}

/**
 * Classify accepted rows in payload order (not in "all creates, then all
 * updates" order) so previews and receipts read like the input, and duplicate
 * identities only surface once (later duplicates are quarantined by the
 * planner and never accepted).
 *
 * The planner intentionally drops `payloadRef` from its output so a dry run
 * never echoes raw references. Identity therefore comes from the caller's row:
 * we pair plan entries back in order under the same `externalId` bucket (or
 * the payloadRef-only bucket, where planner order is input order).
 */
function planRowsInInputOrder(
  rows: PromptImportRow[],
  report: ReturnType<typeof planPromptImport>,
): PlannedRow[] {
  const queues = new Map<string, Array<{ row: PromptImportRow; action: "create" | "update" }>>();
  const enqueue = (row: PromptImportRow, action: "create" | "update") => {
    const key = row.externalId?.trim() || "";
    const queue = queues.get(key) ?? [];
    queue.push({ row, action });
    queues.set(key, queue);
  };
  for (const row of report.created) enqueue(row, "create");
  for (const row of report.updated) enqueue(row, "update");

  const ordered: PlannedRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const ref = computeRowRef(row);
    if (seen.has(ref)) continue;
    const planned = queues.get(row.externalId?.trim() || "")?.shift();
    if (!planned) continue;
    seen.add(ref);
    ordered.push({ row: planned.row, identity: row, action: planned.action });
  }
  return ordered;
}

/**
 * Apply a previewed import through `store`. Idempotent per `previewId`:
 * calling it again (after a crash, timeout, or operator retry) re-verifies the
 * preview, finds rows already stamped with this `importId`, and returns the
 * same receipt without duplicating writes.
 */
export async function commitPromptImport(
  store: ImportStore,
  rows: PromptImportRow[],
  context: {
    previewId: string;
    now?: Date;
    /**
     * Opt-in cryptographic provenance (#1206). When set, the receipt carries
     * a signed, hash-chained attestation over the accepted rows. Signing is
     * deterministic for a fixed `now`/`issuedAt`, so a retried commit
     * reproduces the same attestation.
     */
    provenance?: {
      signer: ProvenanceSigner;
      issuedAt?: Date;
    };
  },
): Promise<ImportReceipt> {
  const existing = await store.listExisting();
  const preview = previewPromptImport(
    rows,
    existing,
    context.now ?? new Date(),
  );
  if (preview.previewId !== context.previewId) {
    throw new ImportPreviewMismatchError();
  }

  const report = planPromptImport(rows, existing);
  const accepted = planRowsInInputOrder(rows, report).filter(
    (planned) => !containsUnsafeContent(planned.row),
  );

  const importId = preview.previewId;
  const receiptRows: ImportReceiptRow[] = [];
  // The signed payload is the exact record persisted by the store, so a
  // verifier can replay the chain from a store export without needing the
  // caller's pre-normalization rows.
  const attestedRecords: Array<{ rowRef: string; record: Record<string, unknown> }> = [];

  for (const planned of accepted) {
    const row = planned.row;
    const externalId = row.externalId!;
    const rowRef = computeRowRef(planned.identity);
    const current = await store.get(externalId);

    if (current && current.importId === importId) {
      // Already written by a previous attempt of this same import — do not
      // duplicate the write and preserve the original receipt identity.
      receiptRows.push({
        action: current.origin,
        externalId,
        rowRef: current.rowRef,
        importId,
      });
      attestedRecords.push({
        rowRef: current.rowRef,
        record: current.row as unknown as Record<string, unknown>,
      });
      continue;
    }

    const origin: "created" | "updated" = current ? "updated" : "created";
    const record: StoredImportedPrompt = {
      externalId,
      creatorWallet: row.creatorWallet!,
      importId,
      rowRef,
      origin,
      previousRecord: current ?? null,
      row: { ...row },
    };
    await store.put(record);
    receiptRows.push({ action: origin, externalId, rowRef, importId });
    attestedRecords.push({
      rowRef,
      record: record.row as unknown as Record<string, unknown>,
    });
  }

  const receiptBase = {
    importId,
    previewId: preview.previewId,
    committedAt: (context.now ?? new Date()).toISOString(),
    rows: receiptRows,
    quarantined: preview.quarantined,
  };

  const receipt: ImportReceipt = {
    ...receiptBase,
    receiptHash: sha256(canonicalReceipt(receiptBase)),
  };

  if (context.provenance) {
    receipt.attestation = createImportAttestation({
      subject: importId,
      records: attestedRecords,
      signer: context.provenance.signer,
      issuedAt: context.provenance.issuedAt ?? context.now ?? new Date(),
    });
  }

  return receipt;
}

/**
 * Reverse a commit. Safe to retry: rows already restored/removed are skipped
 * on the second run. Rows touched by a later import (`importId` mismatch) are
 * never clobbered — they are reported under `skipped` for manual recovery.
 */
export async function rollbackPromptImport(
  store: ImportStore,
  receipt: Pick<ImportReceipt, "importId" | "rows">,
  now: Date = new Date(),
): Promise<RollbackReport> {
  const report: RollbackReport = {
    importId: receipt.importId,
    rolledBackAt: now.toISOString(),
    reverted: 0,
    skipped: [],
  };

  for (const row of receipt.rows) {
    const externalId = row.externalId;
    if (!externalId) {
      report.skipped.push({ externalId: row.rowRef, reason: "missing" });
      continue;
    }

    const current = await store.get(externalId);
    if (!current) {
      // Already rolled back (created row removed) or manually deleted.
      report.skipped.push({ externalId, reason: "missing" });
      continue;
    }

    if (current.importId !== receipt.importId) {
      report.skipped.push({ externalId, reason: "superseded" });
      continue;
    }

    if (row.action === "created") {
      await store.delete(externalId);
      report.reverted += 1;
      continue;
    }

    if (!current.previousRecord) {
      report.skipped.push({ externalId, reason: "missing_snapshot" });
      continue;
    }
    await store.put(current.previousRecord);
    report.reverted += 1;
  }

  return report;
}

/** Reference in-memory store for tests, dry-run tooling, and local CLI runs. */
export function createMemoryImportStore(
  initial: StoredImportedPrompt[] = [],
): ImportStore & { dump(): StoredImportedPrompt[] } {
  const byExternalId = new Map<string, StoredImportedPrompt>(
    initial.map((record) => [record.externalId, record]),
  );

  return {
    async listExisting() {
      return [...byExternalId.values()].map((record) => ({
        externalId: record.externalId,
        creatorWallet: record.creatorWallet,
      }));
    },
    async get(externalId: string) {
      return byExternalId.get(externalId);
    },
    async put(record: StoredImportedPrompt) {
      byExternalId.set(record.externalId, record);
    },
    async delete(externalId: string) {
      byExternalId.delete(externalId);
    },
    dump() {
      return [...byExternalId.values()];
    },
  };
}
