import type { ScannerResult, ScannerVerdict } from "../services/safetyScanner.js";

/**
 * Moderation review queue state machine (#758).
 *
 * A prompt publication verdict maps to one of three review states:
 * - `none`      — scanner allowed (or scanning unavailable), published normally.
 * - `pending`   — scanner queued it; hidden from the marketplace until a
 *                 maintainer approves or rejects.
 * - `approved` / `rejected` — maintainer decisions, recorded with a reason
 *                 code and acting admin for the audit history.
 *
 * Overrides are append-only: every transition is recorded in
 * {@link ModerationReview} rows and the prompt carries the latest decision.
 * Rejected prompts never re-enter the queue without a new scan.
 */

export type ModerationStatus = "none" | "pending" | "approved" | "rejected";

export type OverrideAction = "approve" | "reject";

export type OverrideReasonCode =
  | "false_positive"
  | "policy_exception"
  | "insufficient_evidence"
  | "policy_violation_confirmed"
  | "other";

export interface ScannerInput {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  preview?: string;
  payload?: string;
}

export interface ModerationReview {
  promptId: string;
  action: OverrideAction;
  reasonCode: OverrideReasonCode;
  notes?: string;
  actingAdmin: string;
  createdAt: Date;
  scannerRuleIds: string[];
}

export type { ScannerResult, ScannerVerdict };

/** Verdict → prompt moderation status at publication time. */
export function statusFromVerdict(verdict: ScannerVerdict, scanned: boolean): ModerationStatus {
  if (!scanned) return "none";
  if (verdict === "queue") return "pending";
  if (verdict === "block") return "rejected";
  return "none";
}

/** Legal transitions out of each status when a maintainer acts. */
const ALLOWED_OVERRIDES: Record<ModerationStatus, OverrideAction[]> = {
  none: [],
  pending: ["approve", "reject"],
  approved: [],
  rejected: [],
};

export function canOverride(status: ModerationStatus, action: OverrideAction): boolean {
  return ALLOWED_OVERRIDES[status].includes(action);
}

/** Validates an override payload before it reaches the store. */
export function validateOverride(params: {
  status: ModerationStatus;
  action: OverrideAction;
  reasonCode: OverrideReasonCode;
  actingAdmin?: string;
}): { ok: true } | { ok: false; error: string } {
  if (!canOverride(params.status, params.action)) {
    return {
      ok: false,
      error: `Cannot ${params.action} a prompt in status "${params.status}".`,
    };
  }
  if (!params.actingAdmin || params.actingAdmin.trim().length === 0) {
    return { ok: false, error: "actingAdmin is required for an override." };
  }
  if (params.action === "approve" && params.reasonCode === "policy_violation_confirmed") {
    return {
      ok: false,
      error: "policy_violation_confirmed cannot be used to approve a prompt.",
    };
  }
  if (params.action === "reject" && params.reasonCode === "false_positive") {
    return {
      ok: false,
      error: "false_positive cannot justify rejecting a prompt.",
    };
  }
  return { ok: true };
}
