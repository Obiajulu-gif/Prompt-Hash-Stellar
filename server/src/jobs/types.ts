/**
 * Job types and versioned payloads — keep payloads small (<1KB) and versioned.
 * Bump `version` when shape changes; handlers must handle old versions.
 */

export interface BaseJobPayload {
  version: number; // schema version — handlers switch on this
  createdAt?: string;
}

export interface SettlementPollPayload extends BaseJobPayload {
  version: 1;
  purchaseId: string;
  promptId: string;
  buyerWallet: string;
  txHash?: string;
  ledgerSequence?: number;
}

export interface EntitlementRepairPayload extends BaseJobPayload {
  version: 1;
  promptId: string;
  buyerWallet: string;
  expectedHasAccess?: boolean;
}

export interface AnalyticsAggregatePayload extends BaseJobPayload {
  version: 1;
  windowDays: number;
  creatorWallet?: string; // if omitted, aggregate platform-wide (restricted)
}

export interface ExportCsvPayload extends BaseJobPayload {
  version: 1;
  creatorWallet: string;
  startDate?: string;
  endDate?: string;
  requestedBy: string;
}

export interface StaleDisputeCleanupPayload extends BaseJobPayload {
  version: 1;
  olderThanDays: number;
  dryRun?: boolean;
}

export interface RetentionCleanupPayload extends BaseJobPayload {
  version: 1;
  dryRun?: boolean;
}

export interface ArchivedExportPayload extends BaseJobPayload {
  version: 1;
  archived: true;
}

export type JobPayload =
  | SettlementPollPayload
  | EntitlementRepairPayload
  | AnalyticsAggregatePayload
  | ExportCsvPayload
  | StaleDisputeCleanupPayload
  | RetentionCleanupPayload
  | ArchivedExportPayload;

export type JobType =
  | "settlement_poll"
  | "entitlement_repair"
  | "analytics_aggregate"
  | "export_csv"
  | "stale_dispute_cleanup"
  | "retention_cleanup";

export interface EnqueueOptions {
  maxAttempts?: number;
  delayMs?: number;
  dedupeKey?: string;
  dedupeWindowMs?: number;
}

export interface JobRecordDTO {
  id: string;
  type: JobType;
  status: string;
  payload: JobPayload;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextRunAt: Date;
  createdAt: Date;
  archivedAt?: Date | null;
}
