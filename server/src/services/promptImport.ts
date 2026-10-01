import { createHash } from "node:crypto";
import { migratePromptMetadata, type PromptMetadata } from "@prompthash/schema";

export interface PromptImportRow extends Partial<PromptMetadata> {
  externalId?: string;
  creatorWallet?: string;
  payloadRef?: string;
}

export interface ImportExisting {
  externalId?: string;
  contentHash?: string;
  creatorWallet?: string;
}

export interface ImportCounts {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
}

export interface ImportRemediation {
  rowNumber: number;
  externalId?: string;
  errors: string[];
  remediation: string;
}

export interface ImportReport {
  dryRun: boolean;
  committed: boolean;
  counts: ImportCounts;
  created: PromptImportRow[];
  updated: PromptImportRow[];
  skipped: PromptImportRow[];
  invalid: Array<{ row: PromptImportRow; errors: string[] }>;
  remediationGuidance: ImportRemediation[];
  rollbackGuidance: string;
}

export interface ImportOptions {
  dryRun?: boolean;
}

/** Validates and plans an import with dry-run support, idempotency checks, and rollback guidance. */
export function planPromptImport(
  rows: PromptImportRow[],
  existing: ImportExisting[] = [],
  options: ImportOptions = {}
): ImportReport {
  const isDryRun = options.dryRun !== false;

  const report: ImportReport = {
    dryRun: isDryRun,
    committed: !isDryRun,
    counts: { total: rows.length, created: 0, updated: 0, skipped: 0, invalid: 0 },
    created: [],
    updated: [],
    skipped: [],
    invalid: [],
    remediationGuidance: [],
    rollbackGuidance: isDryRun
      ? "Dry run mode active: No persistent writes or state mutations were executed. All actions were evaluated in-memory."
      : "Live import executed. If partial errors occurred, correct invalid rows and re-run import; existing external IDs guarantee idempotent updates.",
  };

  const seen = new Set<string>();
  const byExternal = new Map(existing.filter((x) => x.externalId).map((x) => [x.externalId!, x]));

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const { payloadRef, ...sanitizedRow } = row;
    const key = row.externalId?.trim() || (payloadRef ? createHash("sha256").update(payloadRef).digest("hex") : "");
    const errors: string[] = [];

    if (!key) errors.push("externalId or payloadRef is required");
    if (!row.creatorWallet) errors.push("creatorWallet is required");

    const metadataResult = migratePromptMetadata(row);
    const metadata = metadataResult?.data;
    if (!metadata) errors.push("invalid prompt metadata schema");

    if (key && seen.has(key)) errors.push("duplicate row key in import batch");

    if (errors.length > 0) {
      report.invalid.push({ row: sanitizedRow, errors });
      report.remediationGuidance.push({
        rowNumber: rowNum,
        externalId: row.externalId,
        errors,
        remediation: `Fix row #${rowNum}: ${errors.join("; ")}. Ensure 'creatorWallet' and either 'externalId' or 'payloadRef' are provided and valid.`,
      });
      return;
    }

    seen.add(key);
    const prior = row.externalId ? byExternal.get(row.externalId) : undefined;

    if (prior && prior.creatorWallet !== row.creatorWallet) {
      const err = ["creator ownership does not match existing record"];
      report.invalid.push({ row: sanitizedRow, errors: err });
      report.remediationGuidance.push({
        rowNumber: rowNum,
        externalId: row.externalId,
        errors: err,
        remediation: `Fix row #${rowNum}: The creatorWallet '${row.creatorWallet}' does not match existing owner '${prior.creatorWallet}' for externalId '${row.externalId}'.`,
      });
      return;
    }

    if (prior) {
      report.updated.push({ ...sanitizedRow, ...metadata });
    } else {
      report.created.push({ ...sanitizedRow, ...metadata });
    }
  });

  report.counts = {
    total: rows.length,
    created: report.created.length,
    updated: report.updated.length,
    skipped: report.skipped.length,
    invalid: report.invalid.length,
  };

  return report;
}
