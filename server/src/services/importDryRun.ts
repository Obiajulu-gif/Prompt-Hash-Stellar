export type ImportRecord = {
  externalId?: string;
  title?: string;
  ownerWallet?: string;
  contentHash?: string;
  price?: number | string;
};

export type ExistingImportRecord = {
  externalId?: string;
  contentHash?: string;
  title?: string;
  ownerWallet?: string;
};

export type ImportDryRunRowResult = {
  rowNumber: number;
  action: "create" | "update" | "skip" | "error";
  externalId?: string;
  contentHash?: string;
  reasons: string[];
};

export type ImportDryRunSummary = {
  totalRows: number;
  creates: number;
  updates: number;
  skips: number;
  errors: number;
  conflicts: number;
};

export type ImportDryRunReport = {
  dryRun: true;
  valid: boolean;
  summary: ImportDryRunSummary;
  rows: ImportDryRunRowResult[];
};

const STELLAR_ACCOUNT_ID = /^G[A-Z0-9]{55}$/;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function validateRecord(record: ImportRecord): string[] {
  const errors: string[] = [];
  const title = normalizeText(record.title);
  const ownerWallet = normalizeText(record.ownerWallet);
  const contentHash = normalizeText(record.contentHash);
  const price = Number(record.price);

  if (title.length < 3) errors.push("title must be at least 3 characters");
  if (!STELLAR_ACCOUNT_ID.test(ownerWallet)) errors.push("ownerWallet must be a Stellar account ID");
  if (contentHash.length < 16) errors.push("contentHash must be at least 16 characters");
  if (!Number.isFinite(price) || price <= 0) errors.push("price must be a positive number");

  return errors;
}

export function createImportDryRunReport(
  records: ImportRecord[],
  existingRecords: ExistingImportRecord[] = [],
): ImportDryRunReport {
  const existingByExternalId = new Map(
    existingRecords
      .filter((record) => normalizeText(record.externalId))
      .map((record) => [normalizeKey(record.externalId), record]),
  );
  const existingByContentHash = new Map(
    existingRecords
      .filter((record) => normalizeText(record.contentHash))
      .map((record) => [normalizeKey(record.contentHash), record]),
  );
  const seenExternalIds = new Set<string>();
  const seenContentHashes = new Set<string>();

  const rows = records.map((record, index): ImportDryRunRowResult => {
    const rowNumber = index + 1;
    const externalId = normalizeText(record.externalId);
    const contentHash = normalizeText(record.contentHash);
    const reasons = validateRecord(record);
    const externalIdKey = normalizeKey(externalId);
    const contentHashKey = normalizeKey(contentHash);

    if (externalIdKey && seenExternalIds.has(externalIdKey)) {
      reasons.push("duplicate externalId in import file");
    }
    if (contentHashKey && seenContentHashes.has(contentHashKey)) {
      reasons.push("duplicate contentHash in import file");
    }

    if (externalIdKey) seenExternalIds.add(externalIdKey);
    if (contentHashKey) seenContentHashes.add(contentHashKey);

    const existingById = externalIdKey ? existingByExternalId.get(externalIdKey) : undefined;
    const existingByHash = contentHashKey ? existingByContentHash.get(contentHashKey) : undefined;

    if (existingById && existingByHash && existingById !== existingByHash) {
      reasons.push("externalId and contentHash match different existing prompts");
    }

    if (reasons.length > 0) {
      return {
        rowNumber,
        action: "error",
        externalId: externalId || undefined,
        contentHash: contentHash || undefined,
        reasons,
      };
    }

    if (existingById || existingByHash) {
      return {
        rowNumber,
        action: "update",
        externalId: externalId || undefined,
        contentHash,
        reasons: ["matches existing prompt"],
      };
    }

    return {
      rowNumber,
      action: "create",
      externalId: externalId || undefined,
      contentHash,
      reasons: [],
    };
  });

  const summary = rows.reduce<ImportDryRunSummary>(
    (acc, row) => {
      acc.totalRows++;
      if (row.action === "create") acc.creates++;
      if (row.action === "update") acc.updates++;
      if (row.action === "skip") acc.skips++;
      if (row.action === "error") {
        acc.errors++;
        if (row.reasons.some((reason) => reason.includes("duplicate") || reason.includes("different existing"))) {
          acc.conflicts++;
        }
      }
      return acc;
    },
    { totalRows: 0, creates: 0, updates: 0, skips: 0, errors: 0, conflicts: 0 },
  );

  return {
    dryRun: true,
    valid: summary.errors === 0,
    summary,
    rows,
  };
}
