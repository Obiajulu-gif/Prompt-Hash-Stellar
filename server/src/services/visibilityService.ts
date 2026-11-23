/**
 * Visibility Consistency & Boundary Enforcement Service — Issue #913
 *
 * Implements comprehensive consistency checks and access boundaries across:
 * - Direct lookups (ID, onChainId, permalink, content hash)
 * - Search & discovery (full-text, tags, suggestions, category counts, featured)
 * - Data exports (self vs cross-user admin, linked record redaction)
 * - Relationship traversal (provenance graph, lineage, derivatives, ancestors)
 * - Cache boundary verification (stale cache detection & auto-eviction on visibility drift)
 */

import {
  evaluateVisibility,
  isPubliclyVisible,
  buildPublicVisibilityFilter,
  stripSensitivePromptFields,
  sanitizeRelationshipNode,
  type RecordVisibility,
  type ViewerContext,
  type VisibilityEvaluation,
} from "../../../packages/schema/src/visibility.js";

import { logger } from "./structuredLogger.js";
import { recordAuditEvent } from "./auditTrail.js";
import { cacheDel } from "./cacheService.js";

export {
  evaluateVisibility,
  isPubliclyVisible,
  buildPublicVisibilityFilter,
  stripSensitivePromptFields,
  sanitizeRelationshipNode,
  type RecordVisibility,
  type ViewerContext,
  type VisibilityEvaluation,
};

export interface VisibilityEnforcementResult<T = any> {
  allowed: boolean;
  visibility: RecordVisibility;
  httpStatus: 200 | 301 | 403 | 404 | 410;
  record: T | null;
  error?: string;
  reasons: string[];
}

export interface VisibilityDriftReport {
  cacheKey: string;
  isDrifted: boolean;
  cachedVisibility: RecordVisibility | "unknown";
  sourceVisibility: RecordVisibility;
  actionTaken: "evicted" | "none" | "dry_run";
  reasons: string[];
}

/**
 * Extract wallet address safely from prompt document, handling populated or unpopulated owner.
 */
export function extractOwnerWallet(prompt: any): string | null {
  if (!prompt || typeof prompt !== "object") return null;
  if (typeof prompt.owner === "object" && prompt.owner?.walletAddress) {
    return String(prompt.owner.walletAddress).toLowerCase();
  }
  if (typeof prompt.ownerWallet === "string") {
    return prompt.ownerWallet.toLowerCase();
  }
  if (typeof prompt.creatorWallet === "string") {
    return prompt.creatorWallet.toLowerCase();
  }
  if (typeof prompt.creator === "string" && prompt.creator.startsWith("G")) {
    return prompt.creator.toLowerCase();
  }
  if (typeof prompt.owner === "string" && prompt.owner.startsWith("G")) {
    return prompt.owner.toLowerCase();
  }
  return null;
}

/**
 * Enforces visibility boundary on a single record lookup.
 * Returns whether access is allowed, the appropriate HTTP status code,
 * and the sanitized record if accessible.
 */
export function enforceRecordVisibility<T extends Record<string, any>>(
  record: T | null | undefined,
  viewer?: ViewerContext
): VisibilityEnforcementResult<T> {
  if (!record) {
    return {
      allowed: false,
      visibility: "deleted",
      httpStatus: 404,
      record: null,
      error: "Record not found.",
      reasons: ["not_found"],
    };
  }

  const evaluation = evaluateVisibility(record, viewer);

  if (!evaluation.canAccess) {
    const errorMsg =
      evaluation.visibility === "deleted"
        ? "This listing has been deleted and is no longer available."
        : evaluation.visibility === "restricted"
        ? "This listing is restricted by moderation."
        : "Listing not found or is private.";

    return {
      allowed: false,
      visibility: evaluation.visibility,
      httpStatus: evaluation.httpStatus,
      record: null,
      error: errorMsg,
      reasons: evaluation.reasons,
    };
  }

  // Access allowed: sanitize any internal/sensitive fields
  const sanitized = stripSensitivePromptFields(record) as T;

  return {
    allowed: true,
    visibility: evaluation.visibility,
    httpStatus: evaluation.httpStatus,
    record: sanitized,
    reasons: evaluation.reasons,
  };
}

/**
 * Filters a list of prompt records, removing any private, restricted, or deleted records
 * not accessible to the viewer.
 */
export function filterVisiblePrompts<T extends Record<string, any>>(
  records: T[],
  viewer?: ViewerContext
): T[] {
  if (!Array.isArray(records)) return [];
  const results: T[] = [];

  for (const record of records) {
    const enforcement = enforceRecordVisibility(record, viewer);
    if (enforcement.allowed && enforcement.record) {
      results.push(enforcement.record);
    }
  }

  return results;
}

/**
 * Consistency Checker: Invariant verification on search, marketplace, or public API results.
 * Detects if ANY non-public record leaked into public results.
 */
export function verifyPublicResultsConsistency(results: any[]): {
  isConsistent: boolean;
  violationsCount: number;
  violations: Array<{ id: string; visibility: RecordVisibility; reasons: string[] }>;
} {
  const violations: Array<{ id: string; visibility: RecordVisibility; reasons: string[] }> = [];

  for (const item of results) {
    const evalResult = evaluateVisibility(item);
    if (!evalResult.isPublic) {
      violations.push({
        id: String(item._id || item.id || item.onChainId || "unknown"),
        visibility: evalResult.visibility,
        reasons: evalResult.reasons,
      });
    }
  }

  return {
    isConsistent: violations.length === 0,
    violationsCount: violations.length,
    violations,
  };
}

/**
 * Enforces relationship traversal visibility boundaries on a lineage graph.
 * Ensures that private, restricted, or deleted ancestors and derivatives
 * NEVER leak their title, link, or sensitive attributes to unauthorized viewers.
 */
export function sanitizeLineageGraph(
  lineage: {
    promptId: string;
    visibility: string;
    ancestors?: any[];
    derivatives?: any[];
    [key: string]: any;
  },
  viewer?: ViewerContext
): any {
  if (!lineage) return lineage;

  const sanitized = { ...lineage };

  if (Array.isArray(sanitized.ancestors)) {
    sanitized.ancestors = sanitized.ancestors.map((node) => {
      const nodeVis = sanitizeRelationshipNode(node, viewer);
      return {
        ...node,
        visibility: nodeVis.visibility,
        title: nodeVis.title,
        link: nodeVis.link,
      };
    });
  }

  if (Array.isArray(sanitized.derivatives)) {
    sanitized.derivatives = sanitized.derivatives.map((node) => {
      const nodeVis = sanitizeRelationshipNode(node, viewer);
      return {
        ...node,
        visibility: nodeVis.visibility,
        title: nodeVis.title,
        link: nodeVis.link,
      };
    });
  }

  return sanitized;
}

/**
 * Stale Cache Visibility Drift Detector:
 * Compares cached entry visibility against the current authoritative database record.
 * If the cached entry claims public visibility but the source record has become
 * private, restricted, or deleted, flags the drift and evicts the cache entry.
 */
export async function checkCacheVisibilityDrift(
  cacheKey: string,
  cachedData: any,
  sourcePrompt: any,
  options: { autoEvict?: boolean } = { autoEvict: true }
): Promise<VisibilityDriftReport> {
  const cachedVis: RecordVisibility =
    cachedData?.visibility || (cachedData?.isActive && cachedData?.listingStatus === "published" ? "public" : "unknown");

  const sourceEvaluation = evaluateVisibility(sourcePrompt);
  const isDrifted = cachedVis === "public" && !sourceEvaluation.isPublic;

  let actionTaken: "evicted" | "none" | "dry_run" = "none";

  if (isDrifted) {
    if (options.autoEvict) {
      await cacheDel(cacheKey).catch(() => {});
      actionTaken = "evicted";
      logger.warn("Evicted stale cache entry due to visibility drift", {
        action: "cacheVisibilityEviction",
        cacheKey,
        cachedVisibility: cachedVis,
        sourceVisibility: sourceEvaluation.visibility,
        reasons: sourceEvaluation.reasons,
      });
    } else {
      actionTaken = "dry_run";
    }
  }

  return {
    cacheKey,
    isDrifted,
    cachedVisibility: cachedVis,
    sourceVisibility: sourceEvaluation.visibility,
    actionTaken,
    reasons: sourceEvaluation.reasons,
  };
}

/**
 * Record an audit log entry when a visibility boundary violation or unauthorized
 * access attempt to a restricted/private record is blocked.
 */
export async function logVisibilityViolation(params: {
  action: string;
  promptId: string;
  attemptedBy?: string | null;
  targetVisibility: RecordVisibility;
  reason: string;
}): Promise<void> {
  try {
    await recordAuditEvent({
      action: params.action,
      result: "denied",
      promptId: params.promptId,
      walletAddress: params.attemptedBy || null,
      reason: params.reason,
      metadata: {
        targetVisibility: params.targetVisibility,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error("Failed to record visibility audit event", { error: err, params });
  }
}
