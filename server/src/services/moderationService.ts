import type { Request, Response } from "express";
import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";
import { requireAdminScope, type AdminRequest } from "../middleware/adminAuth";
import { recordAuditEvent } from "./auditTrail";
import ModerationReview from "../models/ModerationReview";
import {
  validateOverride,
  type OverrideAction,
  type OverrideReasonCode,
} from "../moderation/types";

const REASON_CODES: OverrideReasonCode[] = [
  "false_positive",
  "policy_exception",
  "insufficient_evidence",
  "policy_violation_confirmed",
  "other",
];

/**
 * Lists prompts queued for moderation review (scanner-flagged), plus the
 * review history for a specific prompt when `promptId` is given (#758).
 */
export async function GetModerationQueue(req: Request, res: Response): Promise<Response> {
  try {
    await connectDb();
    const { promptId } = req.query as { promptId?: string };

    if (promptId) {
      const reviews = await ModerationReview.find({ promptId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      return res.json({ promptId, reviews });
    }

    const queued = await Prompt.find({ moderationStatus: "pending" })
      .select("onChainId title category moderationStatus scannerRuleIds createdAt")
      .limit(100)
      .lean();
    return res.json({ queue: queued });
  } catch (err) {
    console.error("Get moderation queue error:", err);
    return res.status(500).json({ error: (err as Error).message || "Failed to load queue" });
  }
}

/**
 * Maintainer override for a scanner-flagged prompt: approve (publish) or
 * reject (keep hidden) with a reason code. Every call is validated against
 * the state machine and appended to the audit history (#758).
 */
export async function OverrideModeration(req: AdminRequest, res: Response): Promise<Response> {
  try {
    await connectDb();
    const body = (req.body || {}) as {
      promptId?: string;
      action?: OverrideAction;
      reasonCode?: OverrideReasonCode;
      notes?: string;
      scannerRuleIds?: string[];
    };
    const { promptId, action, reasonCode, notes } = body;
    const actingAdmin =
      req.admin?.sub || typeof req.headers["x-admin-wallet"] === "string"
        ? String(req.headers["x-admin-wallet"])
        : "";

    if (!promptId || (action !== "approve" && action !== "reject")) {
      return res.status(400).json({ error: "promptId and action (approve|reject) are required." });
    }
    if (!reasonCode || !REASON_CODES.includes(reasonCode)) {
      return res.status(400).json({ error: `reasonCode must be one of: ${REASON_CODES.join(", ")}` });
    }

    const prompt = await Prompt.findOne({ onChainId: promptId }).lean<{
      moderationStatus?: string;
    } | null>();
    if (!prompt) {
      return res.status(404).json({ error: `Prompt ${promptId} not found.` });
    }

    const currentStatus = (prompt.moderationStatus ?? "none") as
      | "none"
      | "pending"
      | "approved"
      | "rejected";
    const check = validateOverride({ status: currentStatus, action, reasonCode, actingAdmin });
    if (!check.ok) {
      return res.status(409).json({ error: check.error });
    }

    const nextStatus = action === "approve" ? "approved" : "rejected";
    await Prompt.findOneAndUpdate(
      { onChainId: promptId },
      {
        $set: {
          moderationStatus: nextStatus,
          moderationDecidedAt: new Date(),
          moderationDecidedBy: actingAdmin,
        },
      },
    );

    await ModerationReview.create({
      promptId,
      action,
      reasonCode,
      notes: typeof notes === "string" ? notes.slice(0, 2000) : "",
      actingAdmin,
      scannerRuleIds: Array.isArray(body.scannerRuleIds) ? body.scannerRuleIds.slice(0, 20) : [],
    });

    await recordAuditEvent({
      action: "moderation.override",
      result: "success",
      promptId,
      reason: `${action}:${reasonCode}`,
      walletAddress: actingAdmin || undefined,
      requestId: typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : null,
    });

    return res.json({ promptId, status: nextStatus, action, reasonCode });
  } catch (err) {
    console.error("Moderation override error:", err);
    return res.status(500).json({ error: (err as Error).message || "Override failed" });
  }
}

/** Route middleware bundle so routes can spread these directly. */
export const moderationAdminGuard = requireAdminScope("moderation:write");
export const moderationReadGuard = requireAdminScope("moderation:read");
