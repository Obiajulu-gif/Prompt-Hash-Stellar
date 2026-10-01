/**
 * Operational Health & Unresolved Exceptions Aggregator (Issue #814)
 *
 * Collects actionable health indicators across jobs, indexers, webhook ingestion,
 * payout ledgers, and support incidents while strictly redacting sensitive credentials.
 */

import InboundWebhookEvent from "../models/InboundWebhookEvent.js";
import QuarantinedEvent from "../models/QuarantinedEvent.js";
import JobRecord from "../models/JobRecord.js";
import Report from "../models/Report.js";
import SupportCase from "../models/SupportCase.js";
import { IndexerState } from "../models/IndexerState.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { logger } from "./structuredLogger.js";

export interface RedactedExceptionItem {
  id: string;
  source: string;
  category: "webhook_failure" | "quarantine" | "dead_letter_job" | "fulfillment_error" | "unhandled_error";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  message: string;
  occurredAt: string;
  investigationLink: string;
  metadata?: Record<string, unknown>;
}

export interface StaleJobItem {
  id: string;
  type: string;
  status: string;
  attempts: number;
  stuckDurationMinutes: number;
  lastError?: string | null;
  investigationLink: string;
}

export interface ReconciliationDriftSummary {
  status: "in_sync" | "drift_detected" | "unknown";
  unsettledLedgerEntriesCount: number;
  unsettledAmountSum: number;
  discrepancyCount: number;
  indexerLagLedgers: number;
  lastIndexedLedger: number;
}

export interface ActiveIncidentItem {
  id: string;
  type: "user_report" | "support_case" | "quarantined_event";
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  investigationLink: string;
}

export interface OperationalHealthReport {
  timestamp: string;
  status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  summary: {
    totalUnresolvedExceptions: number;
    staleJobsCount: number;
    reconciliationDriftCount: number;
    activeIncidentsCount: number;
  };
  categories: {
    unresolvedExceptions: RedactedExceptionItem[];
    staleJobs: StaleJobItem[];
    reconciliationDrift: ReconciliationDriftSummary;
    activeIncidents: ActiveIncidentItem[];
  };
}

const STALE_JOB_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Sanitizes arbitrary values by masking private keys, seeds, tokens, auth headers.
 */
export function sanitizeSensitiveData(input: unknown): any {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") {
    // Stellar secret keys (S...), bearer tokens, passwords, hex secrets
    return input
      .replace(/S[A-Z0-9]{55}/g, "[REDACTED_SECRET_KEY]")
      .replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED_TOKEN]")
      .replace(/(password|secret|apiKey|authorization)["':\s]+["']?([^"'\s,]+)/gi, '$1: "[REDACTED]"');
  }
  if (Array.isArray(input)) {
    return input.map(sanitizeSensitiveData);
  }
  if (typeof input === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("auth") ||
        lowerKey.includes("token") ||
        lowerKey.includes("seed") ||
        lowerKey.includes("private") ||
        lowerKey.includes("key")
      ) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeSensitiveData(val);
      }
    }
    return sanitized;
  }
  return input;
}


export class OperationalHealthService {
  async generateHealthReport(now = new Date()): Promise<OperationalHealthReport> {
    const exceptions: RedactedExceptionItem[] = [];
    const staleJobs: StaleJobItem[] = [];
    const incidents: ActiveIncidentItem[] = [];

    // 1. Unresolved Exceptions: Failed Inbound Webhooks
    try {
      if (InboundWebhookEvent?.find) {
        const failedWebhooks = await InboundWebhookEvent.find({
          status: "failed",
          archivedAt: null,
        })
          .sort({ createdAt: -1 })
          .limit(25)
          .lean();

        for (const item of failedWebhooks as any[]) {
          exceptions.push({
            id: String(item._id || item.eventId || "unknown"),
            source: "InboundWebhook",
            category: "webhook_failure",
            severity: "HIGH",
            message: sanitizeSensitiveData(item.error || item.failureReason || "Webhook processing failed"),
            occurredAt: new Date(item.updatedAt || item.createdAt || now).toISOString(),
            investigationLink: `/api/webhooks/events/${item.eventId || item._id}`,
            metadata: sanitizeSensitiveData({
              eventType: item.eventType,
              retryCount: item.retryCount || 0,
            }),
          });
        }
      }
    } catch (err) {
      logger.error("Failed to query failed webhooks for health dashboard", { error: String(err) });
    }

    // 2. Unresolved Exceptions: Quarantined Events
    try {
      if (QuarantinedEvent?.find) {
        const quarantined = await QuarantinedEvent.find({
          status: { $in: ["quarantined", "open", "pending"] },
        })
          .sort({ createdAt: -1 })
          .limit(25)
          .lean();

        for (const item of quarantined as any[]) {
          exceptions.push({
            id: String(item._id),
            source: "QuarantineQueue",
            category: "quarantine",
            severity: "HIGH",
            message: sanitizeSensitiveData(item.reason || "Payload quarantined by safety filters"),
            occurredAt: new Date(item.createdAt || now).toISOString(),
            investigationLink: `/api/webhooks/quarantine/${item._id}`,
            metadata: sanitizeSensitiveData({
              quarantineReason: item.reason,
            }),
          });

          incidents.push({
            id: String(item._id),
            type: "quarantined_event",
            title: `Quarantined event: ${item.reason || "Safety alert"}`,
            status: item.status || "quarantined",
            priority: "HIGH",
            createdAt: new Date(item.createdAt || now).toISOString(),
            investigationLink: `/api/webhooks/quarantine/${item._id}`,
          });
        }
      }
    } catch (err) {
      logger.error("Failed to query quarantined events for health dashboard", { error: String(err) });
    }

    // 3. Stale & Dead-Letter Background Jobs
    try {
      if (JobRecord?.find) {
        const deadLetterJobs = await JobRecord.find({
          status: "dead_letter",
        })
          .sort({ updatedAt: -1 })
          .limit(25)
          .lean();

        for (const job of deadLetterJobs as any[]) {
          exceptions.push({
            id: String(job.id || job._id),
            source: "JobQueue",
            category: "dead_letter_job",
            severity: "CRITICAL",
            message: sanitizeSensitiveData(job.lastError || "Job moved to dead-letter queue after max attempts"),
            occurredAt: new Date(job.updatedAt || now).toISOString(),
            investigationLink: `/api/jobs/${job.id || job._id}`,
            metadata: {
              jobType: job.type,
              attempts: job.attempts,
            },
          });
        }

        // Stale in-flight jobs
        const staleCutoff = new Date(now.getTime() - STALE_JOB_THRESHOLD_MS);
        const inFlightStale = await JobRecord.find({
          status: { $in: ["processing", "pending"] },
          updatedAt: { $lt: staleCutoff },
        })
          .sort({ updatedAt: 1 })
          .limit(25)
          .lean();

        for (const job of inFlightStale as any[]) {
          const stuckMs = now.getTime() - new Date(job.updatedAt || job.createdAt).getTime();
          staleJobs.push({
            id: String(job.id || job._id),
            type: job.type || "unknown",
            status: job.status,
            attempts: job.attempts || 0,
            stuckDurationMinutes: Math.floor(stuckMs / 60000),
            lastError: sanitizeSensitiveData(job.lastError),
            investigationLink: `/api/jobs/${job.id || job._id}`,
          });
        }
      }
    } catch (err) {
      logger.error("Failed to query job records for health dashboard", { error: String(err) });
    }

    // 4. Reconciliation Drift & Unsettled Entries
    let reconciliationDrift: ReconciliationDriftSummary = {
      status: "in_sync",
      unsettledLedgerEntriesCount: 0,
      unsettledAmountSum: 0,
      discrepancyCount: 0,
      indexerLagLedgers: 0,
      lastIndexedLedger: 0,
    };

    try {
      if (LedgerEntry?.find) {
        const unsettledEntries = await LedgerEntry.find({
          entryType: { $in: ["payout", "escrow_settlement"] },
          stellarTxRef: { $in: [null, "", undefined] },
        }).lean();

        const count = unsettledEntries.length;
        const sum = unsettledEntries.reduce(
          (acc: number, cur: any) => acc + (Number(cur.amount) || 0),
          0
        );

        reconciliationDrift.unsettledLedgerEntriesCount = count;
        reconciliationDrift.unsettledAmountSum = Number(sum.toFixed(4));
        if (count > 0) {
          reconciliationDrift.status = "drift_detected";
        }
      }

      if (IndexerState?.findOne) {
        const indexerState = await IndexerState.findOne({ key: "prompt_hash_contract" }).lean();
        if (indexerState) {
          reconciliationDrift.lastIndexedLedger = (indexerState as any).lastIndexedLedger || 0;
        }
      }
    } catch (err) {
      logger.error("Failed to query ledger entries for health dashboard", { error: String(err) });
    }

    // 5. Active User Reports & Support Incidents
    try {
      if (Report?.find) {
        const openReports = await Report.find({
          status: { $in: ["pending", "investigating", "escalated"] },
        })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean();

        for (const rep of openReports as any[]) {
          incidents.push({
            id: String(rep._id),
            type: "user_report",
            title: `Report on Prompt ${rep.promptId || "N/A"}: ${sanitizeSensitiveData(rep.reason || "Policy concern")}`,
            status: rep.status || "pending",
            priority: rep.status === "escalated" ? "CRITICAL" : "MEDIUM",
            createdAt: new Date(rep.createdAt || now).toISOString(),
            investigationLink: `/api/admin/reports/${rep._id}`,
          });
        }
      }

      if (SupportCase?.find) {
        const openCases = await SupportCase.find({
          status: { $in: ["open", "investigating", "escalated"] },
        })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean();

        for (const sc of openCases as any[]) {
          incidents.push({
            id: String(sc._id || sc.caseId),
            type: "support_case",
            title: `Case #${sc.caseId || sc._id}: ${sanitizeSensitiveData(sc.subject || "User support ticket")}`,
            status: sc.status || "open",
            priority: sc.priority || "MEDIUM",
            createdAt: new Date(sc.createdAt || now).toISOString(),
            investigationLink: `/api/support-cases/${sc.caseId || sc._id}`,
          });
        }
      }
    } catch (err) {
      logger.error("Failed to query support incidents for health dashboard", { error: String(err) });
    }

    // Calculate aggregate system status
    let overallStatus: "HEALTHY" | "DEGRADED" | "CRITICAL" = "HEALTHY";
    const criticalExceptions = exceptions.filter((e) => e.severity === "CRITICAL").length;

    if (criticalExceptions > 0 || staleJobs.length > 5 || reconciliationDrift.unsettledLedgerEntriesCount > 10) {
      overallStatus = "CRITICAL";
    } else if (exceptions.length > 0 || staleJobs.length > 0 || incidents.length > 0) {
      overallStatus = "DEGRADED";
    }

    return {
      timestamp: now.toISOString(),
      status: overallStatus,
      summary: {
        totalUnresolvedExceptions: exceptions.length,
        staleJobsCount: staleJobs.length,
        reconciliationDriftCount: reconciliationDrift.unsettledLedgerEntriesCount,
        activeIncidentsCount: incidents.length,
      },
      categories: {
        unresolvedExceptions: exceptions,
        staleJobs,
        reconciliationDrift,
        activeIncidents: incidents,
      },
    };
  }
}

export const operationalHealthService = new OperationalHealthService();
