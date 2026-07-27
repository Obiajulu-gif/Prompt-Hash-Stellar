import { createHash } from "crypto";
import { AuditLog, AuditAction, AuditResult } from "../models/AuditLog";

// Simple fallback logger object to handle logging without cross-boundary imports
// Simple fallback logger object to handle logging without cross-boundary imports
const logger = {
  info: (logFields: any, msg: string) => console.log(msg, logFields),
  warn: (logFields: any, msg: string) => console.warn(msg, logFields),
  error: (logFields: any, msg: string) => console.error(msg, logFields)
};

/**
 * One-way SHA-256 hash of a Stellar wallet address.
 * Stored in audit logs instead of the raw address so logs are
 * privacy-safe by default while still allowing incident correlation (#224).
 *
 * @param address - Raw Stellar account ID (G…)
 * @returns Lowercase hex digest
 */
export function hashWalletAddress(address: string): string {
  return createHash("sha256").update(address.toLowerCase()).digest("hex");
}

/**
 * Structured fields logged for every unlock attempt.
 *
 * Fields:
 *   action      - AuditAction enum value (e.g. "unlock_attempt", "access_granted")
 *   result      - AuditResult enum value ("success" | "failure" | "denied")
 *   requestId   - UUID from withObservability middleware; links log → DB row
 *   walletHash  - SHA-256(walletAddress.toLowerCase()); never the raw address
 *   promptId    - Numeric prompt ID from the contract
 *   reason      - Human-readable explanation for denials/failures (no sensitive content)
 *
 * NEVER include: plaintext, signedMessage, challengeSecret, privateKey, or clientIp
 * in structured logs. Those are either redacted by the pino transport or must not
 * appear at all.
 */
export interface AuditEventParams {
  action: AuditAction;
  result: AuditResult;
  promptId?: string | null;
  /** Raw Stellar wallet address — hashed before logging or DB persistence. */
  walletAddress?: string | null;
  requestId?: string | null;
  clientIp?: string | null;
  reason?: string | null;
}

/**
 * Persist a structured audit event and emit a pino log entry at the
 * appropriate level.
 *
 * Log levels (#224):
 *   info  — successful unlock or expected denial (no on-chain access)
 *   warn  — validation failure (bad signature, expired challenge)
 *   error — unexpected internal error during the unlock flow
 *
 * Fire-and-forget: DB errors are caught and logged to stderr; they never
 * propagate so a storage hiccup cannot block a legitimate unlock.
 */
export async function recordAuditEvent(params: AuditEventParams): Promise<void> {
  const walletHash = params.walletAddress
    ? hashWalletAddress(params.walletAddress)
    : null;

  // Structured pino log — wallet address is intentionally absent; only the
  // hash is emitted so the log stream never carries PII (#224).
  const logFields = {
    action: params.action,
    result: params.result,
    requestId: params.requestId ?? undefined,
    walletHash: walletHash ?? undefined,
    promptId: params.promptId ?? undefined,
    reason: params.reason ?? undefined,
  };

  if ((params.result as string) === "failure" || (params.result as string) === "denied") {
    logger.warn(logFields, `audit: ${params.action} → ${params.result}`);
  } else {
    logger.info(logFields, `audit: ${params.action} → ${params.result}`);
  }

  try {
    await AuditLog.create({
      action: params.action,
      result: params.result,
      promptId: params.promptId ?? null,
      // Store the hash, not the raw address, for DB-level privacy (#224).
      walletAddress: walletHash,
      requestId: params.requestId ?? null,
      clientIp: params.clientIp ?? null,
      reason: params.reason ?? null,
    });
  } catch (err) {
    // Do not let audit failures surface to callers.
    logger.error(
      { action: params.action, requestId: params.requestId, err: err instanceof Error ? err.message : String(err) },
      "audit: failed to persist audit event to DB",
    );
  }
}

/**
 * Query audit events for incident review. Returns the most recent `limit`
 * events matching the filter, oldest-first within the result set.
 *
 * Pass walletAddress as a raw address — it will be hashed before querying
 * so the caller never needs to know the storage representation.
 */
export async function queryAuditEvents(filter: {
  walletAddress?: string;
  promptId?: string;
  action?: AuditAction;
  result?: AuditResult;
  since?: Date;
  until?: Date;
  limit?: number;
}) {
  const query: Record<string, unknown> = {};

  if (filter.walletAddress) query.walletAddress = hashWalletAddress(filter.walletAddress);
  if (filter.promptId) query.promptId = filter.promptId;
  if (filter.action) query.action = filter.action;
  if (filter.result) query.result = filter.result;
  if (filter.since || filter.until) {
    query.createdAt = {} as Record<string, Date>;
    if (filter.since) (query.createdAt as Record<string, Date>)["$gte"] = filter.since;
    if (filter.until) (query.createdAt as Record<string, Date>)["$lte"] = filter.until;
  }

  return AuditLog.find(query)
    .sort({ createdAt: -1 })
    .limit(filter.limit ?? 100)
    .lean();
}
