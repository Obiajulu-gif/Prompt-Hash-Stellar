export type RetentionDataType =
  | "promptEvents"
  | "exports"
  | "supportEvidence"
  | "auditLogs"
  | "financialRecords"
  | "blockchainRecords";

export interface RetentionCandidate {
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  completedAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  status?: string | null;
  processingStatus?: string | null;
  retentionHold?: boolean;
  archivedAt?: Date | string | null;
}

export const RETENTION_POLICIES = {
  promptEvents: {
    retentionDays: 30,
    action: "archive-and-scrub",
    eligibleStatuses: ["processed", "skipped", "replayed", "discarded"],
  },
  exports: {
    retentionDays: 30,
    action: "archive-and-scrub",
    eligibleStatuses: ["completed", "failed", "dead_letter"],
  },
  supportEvidence: {
    retentionDays: 365,
    action: "archive-and-scrub",
    eligibleStatuses: ["resolved", "dismissed"],
  },
  auditLogs: {
    retentionDays: null,
    action: "preserve",
    eligibleStatuses: [],
  },
  financialRecords: {
    retentionDays: null,
    action: "preserve",
    eligibleStatuses: [],
  },
  blockchainRecords: {
    retentionDays: null,
    action: "preserve",
    eligibleStatuses: [],
  },
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function getRetentionCutoff(
  dataType: RetentionDataType,
  now = new Date(),
): Date | null {
  const retentionDays = RETENTION_POLICIES[dataType].retentionDays;
  return retentionDays === null
    ? null
    : new Date(now.getTime() - retentionDays * DAY_MS);
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isRetentionEligible(
  dataType: RetentionDataType,
  candidate: RetentionCandidate,
  now = new Date(),
): boolean {
  const policy = RETENTION_POLICIES[dataType];
  const cutoff = getRetentionCutoff(dataType, now);
  if (
    cutoff === null ||
    candidate.retentionHold === true ||
    candidate.archivedAt != null
  ) {
    return false;
  }

  const status =
    dataType === "promptEvents"
      ? (candidate.processingStatus ?? candidate.status)
      : candidate.status;
  if (!(policy.eligibleStatuses as readonly string[]).includes(status ?? "")) {
    return false;
  }

  let effectiveDate = candidate.createdAt ?? candidate.updatedAt;
  if (dataType === "exports") {
    effectiveDate = candidate.completedAt ?? candidate.updatedAt;
  } else if (dataType === "supportEvidence") {
    effectiveDate = candidate.resolvedAt ?? candidate.updatedAt;
  } else if (dataType === "promptEvents" && !candidate.processingStatus) {
    effectiveDate = candidate.updatedAt ?? candidate.createdAt;
  }
  const date = parseDate(effectiveDate);
  return date !== null && date < cutoff;
}
