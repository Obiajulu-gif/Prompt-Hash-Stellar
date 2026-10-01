import { AuditAction, AuditResult } from "../models/AuditLog";
import { recordAuditEvent, logger } from "./auditTrail";

export interface SensitiveAccessParams {
  actor: string;
  resourceId: string;
  resourceType: string;
  fieldName: string;
  purpose: string;
  isAuthorized: boolean;
  clientIp?: string;
  reason?: string;
  fieldValue?: any; // To test redaction (should not be logged)
}

// In-memory cache for anomaly detection hooks
const accessCache = new Map<string, number[]>();
const BULK_THRESHOLD = 50; // Threshold for bulk access
const TIME_WINDOW_MS = 60000; // 1 minute

export async function detectAnomaly(actor: string, fieldName: string, isAuthorized: boolean) {
  const key = `${actor}:${fieldName}:${isAuthorized ? 'auth' : 'denied'}`;
  const now = Date.now();
  
  let timestamps = accessCache.get(key) || [];
  timestamps = timestamps.filter(t => now - t < TIME_WINDOW_MS);
  timestamps.push(now);
  accessCache.set(key, timestamps);

  if (timestamps.length >= BULK_THRESHOLD) {
    logger.warn(`anomaly_detected: Bulk access pattern detected for ${actor} on field ${fieldName}`, {
      actor,
      fieldName,
      count: timestamps.length,
      isAuthorized
    });
    return true; // Anomaly detected
  }
  return false;
}

export function resetAnomalyCache() {
  accessCache.clear();
}

export async function logSensitiveFieldAccess(params: SensitiveAccessParams) {
  const action: AuditAction = params.isAuthorized 
    ? "audit_sensitive_field_access" 
    : "audit_sensitive_field_denied";
  const result: AuditResult = params.isAuthorized ? "success" : "failure";

  // Hook for anomaly detection
  const isAnomaly = await detectAnomaly(params.actor, params.fieldName, params.isAuthorized);

  // Note: we intentionally do NOT include params.fieldValue in the metadata or anywhere in the audit log
  await recordAuditEvent({
    action,
    result,
    actor: params.actor,
    target: params.resourceId,
    targetType: params.resourceType,
    metadata: {
      fieldName: params.fieldName,
      purpose: params.purpose,
      anomalyDetected: isAnomaly
    },
    clientIp: params.clientIp,
    reason: params.reason
  });
}
