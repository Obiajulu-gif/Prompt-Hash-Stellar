/**
 * Audit evidence for administrative configuration changes (#1026).
 *
 * Every admin mutation of runtime configuration (feature flags today; the
 * helper is generic so other config surfaces can adopt it) goes through
 * `applyAuditedConfigChange`, which guarantees:
 *
 *   - success  — the change is applied and a hash-chained `admin_config_change`
 *                record captures actor, before/after state, the changed
 *                fields, and a change id.
 *   - failure  — a change that throws is recorded with `result: "failure"`
 *                (best effort) and the original error is rethrown.
 *   - no evidence, no change — if the success record cannot be persisted the
 *                change is rolled back to its before-state and
 *                `AuditEvidenceUnavailableError` is thrown, so configuration
 *                can never drift without a matching audit record.
 *   - retry    — a retried change whose target already matches the requested
 *                state is still recorded, flagged `noop: true`, so the trail
 *                shows every attempt without implying a second mutation.
 *
 * Authorization is enforced upstream by `requireAdminScope`; denied requests
 * never reach this module and are already recorded as `admin_auth_denied`.
 * See docs/operations/admin-config-audit.md.
 */

import { randomUUID } from "crypto";
import { AuditLog } from "../models/AuditLog";
import { logger, recordAuditEvent, sanitizeAuditState } from "./auditTrail";

export const ADMIN_CONFIG_TARGET_TYPE = "admin_config";

export type AdminConfigType =
  | "feature_flag"
  | "policy_limit"
  | "maintenance_banner"
  | "system_config";

export type AdminConfigOperation =
  | "create"
  | "update"
  | "delete"
  | "emergency_disable"
  | "revoke"
  | "toggle";

type ConfigState = Record<string, unknown>;

export class AuditEvidenceUnavailableError extends Error {
  readonly code = "audit_evidence_unavailable";
  constructor(
    message: string,
    readonly rolledBack: boolean,
  ) {
    super(message);
    this.name = "AuditEvidenceUnavailableError";
  }
}

export interface AuditedConfigChange<T> {
  actor: string;
  configType: AdminConfigType;
  configKey: string;
  operation: AdminConfigOperation;
  reason?: string | null;
  requestId?: string | null;
  clientIp?: string | null;
  /** Caller-supplied id (e.g. Idempotency-Key) so retries share one id. */
  changeId?: string | null;
  /**
   * When false, a change whose evidence cannot be recorded is KEPT (and the
   * gap logged) instead of rolled back. Only for safety switches such as an
   * emergency disable, where blocking the change is worse than missing
   * evidence. Defaults to true.
   */
  requireEvidence?: boolean;
  /** Reads the current state; `null` when the config does not exist. */
  load: () => Promise<T | null>;
  /** Applies the change and returns the resulting state (`null` once deleted). */
  apply: () => Promise<T | null>;
  /** Restores `before` when the change cannot be evidenced. */
  restore: (before: T | null) => Promise<void>;
  /** Projects a stored config document onto the fields worth auditing. */
  snapshot: (value: T) => ConfigState;
}

export interface AuditedConfigResult<T> {
  value: T | null;
  changeId: string;
  changedFields: string[];
  noop: boolean;
  /** False only when `requireEvidence: false` and the record failed. */
  auditRecorded: boolean;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** Top-level keys whose values differ between two snapshots, sorted. */
export function diffConfigState(before: ConfigState | null, after: ConfigState | null): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys]
    .filter((key) => stableJson(before?.[key]) !== stableJson(after?.[key]))
    .sort();
}

export function configTarget(configType: AdminConfigType, configKey: string): string {
  return `${configType}:${configKey}`;
}

export async function applyAuditedConfigChange<T>(
  change: AuditedConfigChange<T>,
): Promise<AuditedConfigResult<T>> {
  const changeId = change.changeId || randomUUID();
  const target = configTarget(change.configType, change.configKey);
  const before = await change.load();
  const beforeState = before ? sanitizeAuditState(change.snapshot(before)) : null;

  const base = {
    action: "admin_config_change" as const,
    actor: change.actor,
    target,
    targetType: ADMIN_CONFIG_TARGET_TYPE,
    requestId: change.requestId ?? null,
    clientIp: change.clientIp ?? null,
    reason: change.reason ?? null,
  };

  let after: T | null;
  try {
    after = await change.apply();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordAuditEvent({
      ...base,
      result: "failure",
      beforeState,
      afterState: beforeState,
      metadata: {
        changeId,
        configType: change.configType,
        operation: change.operation,
        error: message.slice(0, 200),
      },
    });
    throw err;
  }

  const afterState = after ? sanitizeAuditState(change.snapshot(after)) : null;
  const changedFields = diffConfigState(beforeState, afterState);
  const noop = changedFields.length === 0;

  try {
    await recordAuditEvent(
      {
        ...base,
        result: "success",
        beforeState,
        afterState,
        metadata: {
          changeId,
          configType: change.configType,
          operation: change.operation,
          changedFields,
          noop,
        },
      },
      { throwOnError: true },
    );
  } catch (auditErr) {
    if (change.requireEvidence === false) {
      logger.error("admin config: change applied WITHOUT audit evidence (requireEvidence=false)", {
        action: "admin_config_change",
        target,
        changeId,
        operation: change.operation,
        actor: change.actor,
        beforeState,
        afterState,
        err: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
      return { value: after, changeId, changedFields, noop, auditRecorded: false };
    }
    // No evidence, no change: put the config back the way we found it.
    let rolledBack = noop;
    if (!noop) {
      try {
        await change.restore(before);
        rolledBack = true;
      } catch (restoreErr) {
        logger.error("admin config: rollback after audit failure FAILED — manual repair needed", {
          action: "admin_config_change",
          target,
          changeId,
          err: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
        });
      }
    }
    logger.error("admin config: audit evidence unavailable, change rejected", {
      action: "admin_config_change",
      target,
      changeId,
      rolledBack,
      err: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
    throw new AuditEvidenceUnavailableError(
      "Configuration change rejected: audit evidence could not be recorded.",
      rolledBack,
    );
  }

  return { value: after, changeId, changedFields, noop, auditRecorded: true };
}

export interface ConfigChangeEvidence {
  createdAt: string;
  actor: string | null;
  result: string;
  target: string;
  operation: string | null;
  changeId: string | null;
  changedFields: string[];
  noop: boolean;
  beforeState: unknown;
  afterState: unknown;
  reason: string | null;
  requestId: string | null;
  recordHash: string;
  previousHash: string;
}

export function toConfigChangeEvidence(row: any): ConfigChangeEvidence {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    createdAt: new Date(row.createdAt).toISOString(),
    actor: row.actor ?? null,
    result: row.result,
    target: row.target,
    operation: typeof metadata.operation === "string" ? metadata.operation : null,
    changeId: typeof metadata.changeId === "string" ? metadata.changeId : null,
    changedFields: Array.isArray(metadata.changedFields) ? (metadata.changedFields as string[]) : [],
    noop: metadata.noop === true,
    beforeState: row.beforeState ?? null,
    afterState: row.afterState ?? null,
    reason: row.reason ?? null,
    requestId: row.requestId ?? null,
    recordHash: row.recordHash,
    previousHash: row.previousHash,
  };
}

/** Newest-first configuration change evidence, optionally narrowed. */
export async function queryConfigChangeEvidence(filter: {
  configType?: AdminConfigType;
  configKey?: string;
  actor?: string;
  changeId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}): Promise<ConfigChangeEvidence[]> {
  const query: Record<string, any> = {
    action: "admin_config_change",
    targetType: ADMIN_CONFIG_TARGET_TYPE,
  };
  if (filter.configType && filter.configKey) {
    query.target = configTarget(filter.configType, filter.configKey);
  } else if (filter.configType) {
    query["metadata.configType"] = filter.configType;
  }
  if (filter.actor) query.actor = filter.actor;
  if (filter.changeId) query["metadata.changeId"] = filter.changeId;
  if (filter.since || filter.until) {
    query.createdAt = {};
    if (filter.since) query.createdAt.$gte = filter.since;
    if (filter.until) query.createdAt.$lte = filter.until;
  }
  const limit = Math.min(Math.max(Math.floor(filter.limit ?? 50), 1), 200);
  const rows = await AuditLog.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  return rows.map(toConfigChangeEvidence);
}
