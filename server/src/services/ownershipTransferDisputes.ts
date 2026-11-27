/**
 * Ownership transfer dispute rules (#907).
 *
 * An approved ownership transfer can be contested (by either party) within a
 * window after it was approved. While the dispute is open the listing is on
 * hold: new transfer requests for it are refused, so the contested owner
 * cannot be moved again before a maintainer decides. A maintainer then either
 * accepts the dispute (the listing is handed back to the previous owner) or
 * rejects it (the transfer stands). Every state change is audited by the
 * controllers in `controllers/ownershipDisputeControllers.ts`.
 *
 * This module is pure: no database access, so the rules are unit-tested
 * directly. Dispute states:
 *
 *   open ──withdraw (filer)──────────▶ withdrawn
 *     │
 *     ├──accept (maintainer)─────────▶ accepted   (ownership reverted)
 *     └──reject (maintainer)─────────▶ rejected   (transfer stands)
 */

import type { TransferStatus } from "../models/OwnershipTransfer";
import { enforceContentAllowList, enforceUrlAllowList } from "./allowListPolicy";

export const DISPUTE_STATUSES = ["open", "accepted", "rejected", "withdrawn"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export type DisputeAction = "withdraw" | "accept" | "reject";
export type DisputeActorRole = "filer" | "maintainer";

/** A transfer can be disputed for this long after its approval. */
export const DISPUTE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_DISPUTE_REASON_LENGTH = 1000;
export const MAX_EVIDENCE_NOTE_LENGTH = 2000;
export const MAX_EVIDENCE_URL_LENGTH = 500;
export const MAX_EVIDENCE_ITEMS = 10;

const DISPUTE_TRANSITIONS: Record<DisputeAction, { from: DisputeStatus; to: DisputeStatus; actor: DisputeActorRole }> = {
  withdraw: { from: "open", to: "withdrawn", actor: "filer" },
  accept: { from: "open", to: "accepted", actor: "maintainer" },
  reject: { from: "open", to: "rejected", actor: "maintainer" },
};

export type RuleResult = { ok: true } | { ok: false; status: number; error: string };

export interface DisputeEligibilityInput {
  transfer: {
    status: TransferStatus;
    fromWallet: string;
    toWallet: string;
    decidedAt?: Date | null;
  };
  filerWallet: string;
  hasOpenDispute: boolean;
  now: number;
}

/** Whether a transfer may be disputed by `filerWallet` right now. */
export function checkDisputeEligibility(input: DisputeEligibilityInput): RuleResult {
  const { transfer } = input;
  if (transfer.status !== "approved") {
    return { ok: false, status: 409, error: "Only an approved transfer can be disputed." };
  }

  const filer = input.filerWallet.toLowerCase();
  if (filer !== transfer.fromWallet.toLowerCase() && filer !== transfer.toWallet.toLowerCase()) {
    return { ok: false, status: 403, error: "Only a party to this transfer can dispute it." };
  }

  if (input.hasOpenDispute) {
    return { ok: false, status: 409, error: "This transfer already has an open dispute." };
  }

  if (!transfer.decidedAt) {
    return { ok: false, status: 409, error: "This transfer has no approval time, so it cannot be disputed." };
  }
  if (input.now - new Date(transfer.decidedAt).getTime() > DISPUTE_WINDOW_MS) {
    return { ok: false, status: 409, error: "The dispute window for this transfer has closed." };
  }

  return { ok: true };
}

/** Whether a dispute in `action` may move from `current` as `actor`. */
export function checkDisputeTransition(
  current: DisputeStatus,
  action: DisputeAction,
  actor: DisputeActorRole,
): RuleResult {
  const rule = DISPUTE_TRANSITIONS[action];
  if (rule.actor !== actor) {
    const who = rule.actor === "filer" ? "the dispute filer" : "a maintainer";
    return { ok: false, status: 403, error: `Only ${who} can ${action} a dispute.` };
  }
  if (current !== rule.from) {
    return { ok: false, status: 409, error: `Dispute is already ${current}.` };
  }
  return { ok: true };
}

/** An open dispute holds the listing: new transfer requests are refused. */
export function isHoldActive(status: DisputeStatus): boolean {
  return status === "open";
}

type Checked<T extends object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export function validateDisputeReason(reason: unknown): Checked<{ value: string }> {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { ok: false, status: 400, error: "A reason for the dispute is required." };
  }
  if (reason.trim().length > MAX_DISPUTE_REASON_LENGTH) {
    return { ok: false, status: 400, error: `Reason must be at most ${MAX_DISPUTE_REASON_LENGTH} characters.` };
  }
  return { ok: true, value: reason.trim() };
}

export function validateEvidence(
  input: { note?: unknown; evidenceUrl?: unknown },
  existingCount: number,
): Checked<{ note: string; evidenceUrl: string }> {
  if (existingCount >= MAX_EVIDENCE_ITEMS) {
    return { ok: false, status: 409, error: `This dispute already holds ${MAX_EVIDENCE_ITEMS} evidence items.` };
  }
  if (typeof input.note !== "string" || input.note.trim().length === 0) {
    return { ok: false, status: 400, error: "An evidence note is required." };
  }
  if (input.note.trim().length > MAX_EVIDENCE_NOTE_LENGTH) {
    return { ok: false, status: 400, error: `Evidence note must be at most ${MAX_EVIDENCE_NOTE_LENGTH} characters.` };
  }
  const noteContentDecision = enforceContentAllowList(
    { content: input.note.trim(), contentType: "text/plain" },
    "evidence_note",
    { context: "ownership_dispute_note" },
  );
  if (!noteContentDecision.allowed) {
    return {
      ok: false,
      status: 400,
      error: noteContentDecision.message ?? "Evidence note contains disallowed content.",
    };
  }

  let evidenceUrl = "";
  if (input.evidenceUrl !== undefined && input.evidenceUrl !== null && input.evidenceUrl !== "") {
    if (typeof input.evidenceUrl !== "string" || input.evidenceUrl.length > MAX_EVIDENCE_URL_LENGTH) {
      return { ok: false, status: 400, error: `Evidence URL must be at most ${MAX_EVIDENCE_URL_LENGTH} characters.` };
    }
    let parsed: URL;
    try {
      parsed = new URL(input.evidenceUrl);
    } catch {
      return { ok: false, status: 400, error: "Evidence URL is not a valid URL." };
    }
    if (parsed.protocol !== "https:") {
      return { ok: false, status: 400, error: "Evidence URL must use https." };
    }
    const urlDecision = enforceUrlAllowList(input.evidenceUrl, "dispute_evidence", {
      context: "ownership_dispute_evidence",
    });
    if (!urlDecision.allowed) {
      return {
        ok: false,
        status: 400,
        error: urlDecision.message ?? "Evidence URL is not allowed.",
      };
    }
    evidenceUrl = urlDecision.normalizedUrl ?? parsed.toString();
  }

  return { ok: true, note: input.note.trim(), evidenceUrl };
}

const STATUS_LABELS: Record<DisputeStatus, string> = {
  open: "Under review. The listing is on hold.",
  accepted: "Accepted. The transfer was reversed.",
  rejected: "Rejected. The transfer stands.",
  withdrawn: "Withdrawn by the filer. The transfer stands.",
};

export interface DisputeRecordLike {
  _id: unknown;
  transferId: string;
  promptId: string;
  fromWallet: string;
  toWallet: string;
  filerWallet: string;
  status: DisputeStatus;
  reason: string;
  evidence: Array<{ wallet: string; role: string; note: string; evidenceUrl?: string; submittedAt: Date }>;
  resolvedBy?: string | null;
  resolvedAt?: Date | null;
  resolutionNotes?: string | null;
  createdAt: Date;
}

/**
 * Dispute state for an API response. Parties see the status, the hold, and
 * the evidence; maintainers also see who filed and who decided.
 */
export function toDisputeView(dispute: DisputeRecordLike, viewer: "party" | "maintainer") {
  const view = {
    id: String(dispute._id),
    transferId: dispute.transferId,
    promptId: dispute.promptId,
    status: dispute.status,
    statusLabel: STATUS_LABELS[dispute.status],
    holdActive: isHoldActive(dispute.status),
    reason: dispute.reason,
    openedAt: dispute.createdAt,
    resolvedAt: dispute.resolvedAt ?? null,
    resolutionNotes: dispute.resolutionNotes ?? null,
    evidence: dispute.evidence.map((item) => ({
      role: item.role,
      note: item.note,
      evidenceUrl: item.evidenceUrl || null,
      submittedAt: item.submittedAt,
      ...(viewer === "maintainer" ? { wallet: item.wallet } : {}),
    })),
  };

  if (viewer === "maintainer") {
    return {
      ...view,
      fromWallet: dispute.fromWallet,
      toWallet: dispute.toWallet,
      filerWallet: dispute.filerWallet,
      resolvedBy: dispute.resolvedBy ?? null,
    };
  }
  return view;
}
