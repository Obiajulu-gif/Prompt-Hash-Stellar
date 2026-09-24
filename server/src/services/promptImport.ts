import { createHash } from "node:crypto";
import { migratePromptMetadata, type PromptMetadata } from "../../../packages/schema/src/promptMetadata.js";

export interface PromptImportRow extends Partial<PromptMetadata> {
  externalId?: string;
  creatorWallet?: string;
  payloadRef?: string;
}
export interface ImportExisting { externalId?: string; contentHash?: string; creatorWallet?: string }
export interface ImportReport { created: PromptImportRow[]; updated: PromptImportRow[]; skipped: PromptImportRow[]; invalid: Array<{ row: PromptImportRow; errors: string[] }> }

/** Validates and plans an import without logging payloads or mutating storage. */
export function planPromptImport(rows: PromptImportRow[], existing: ImportExisting[] = []): ImportReport {
  const report: ImportReport = { created: [], updated: [], skipped: [], invalid: [] };
  const seen = new Set<string>();
  const byExternal = new Map(existing.filter((x) => x.externalId).map((x) => [x.externalId!, x]));
  for (const row of rows) {
    const key = row.externalId?.trim() || (row.payloadRef ? createHash("sha256").update(row.payloadRef).digest("hex") : "");
    const errors: string[] = [];
    if (!key) errors.push("externalId or payloadRef is required");
    if (!row.creatorWallet) errors.push("creatorWallet is required");
    const metadata = migratePromptMetadata(row).data;
    if (!metadata) errors.push("invalid prompt metadata");
    if (key && seen.has(key)) errors.push("duplicate row in import");
    if (errors.length) { report.invalid.push({ row, errors }); continue; }
    seen.add(key);
    const prior = byExternal.get(row.externalId!);
    if (prior && prior.creatorWallet !== row.creatorWallet) { report.invalid.push({ row, errors: ["creator ownership does not match existing record"] }); continue; }
    if (prior) report.updated.push({ ...row, ...metadata });
    else report.created.push({ ...row, ...metadata });
  }
  return report;
}
