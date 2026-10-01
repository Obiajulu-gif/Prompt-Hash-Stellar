/**
 * Bulk moderation queue controllers (#moderation-queue).
 *
 * Endpoints:
 *   GET  /api/moderation/queue              – filtered, paginated prompt queue
 *   POST /api/moderation/bulk               – bulk approve/reject/hide/restore
 *   GET  /api/moderation/decisions          – decision audit list
 *   POST /api/moderation/decisions/:id/rollback – rollback a single decision
 *
 * Design decisions:
 *
 *  Stale-query protection
 *  ----------------------
 *  Bulk actions only apply to prompts whose current `moderationStatus` matches
 *  the expected pre-condition for the requested action (e.g. "approve" only
 *  applies to prompts in "pending_review" or "rejected"). Prompts that have
 *  moved to a different state since the moderator loaded the queue are counted
 *  as `skipped`, not failures. This prevents accidental bulk actions on stale
 *  query results.
 *
 *  Audit trail
 *  -----------
 *  Every applied action creates a ModerationDecision document AND calls
 *  recordAuditEvent so the immutable hash-chained AuditLog has a record.
 *  The actor wallet is hashed before storage (privacy, consistent with
 *  existing audit trail).
 *
 *  Notification fan-out
 *  --------------------
 *  When a prompt is hidden or restored, a moderation_action notification is
 *  created for the prompt owner via notificationService.createNotification.
 *
 *  Rollback
 *  --------
 *  Rollback is a first-class operation: it reapplies `previousStatus` to the
 *  Prompt and marks the original ModerationDecision as rolled back with a
 *  reason and timestamp. The original decision is never deleted.
 */

import { Request, Response } from "express";
import { createHash } from "crypto";
import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";
import ModerationDecision, {
  ModerationAction,
  ModerationStatus,
} from "../models/ModerationDecision";
import { recordAuditEvent } from "../services/auditTrail";
import { createNotification } from "../services/notificationService";
import { AdminRequest } from "../middleware/adminAuth";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashWallet(wallet: string): string {
  return createHash("sha256").update(wallet.toLowerCase()).digest("hex");
}

/** Maps each action to the set of prompt statuses it is allowed to act on. */
const ELIGIBLE_STATUSES: Record<ModerationAction, ModerationStatus[]> = {
  approve:  ["pending_review", "rejected"],
  reject:   ["pending_review", "approved"],
  hide:     ["pending_review", "approved", "rejected", "restored"],
  restore:  ["hidden", "rejected"],
};

/** Maps each action to the resulting moderationStatus. */
const RESULTING_STATUS: Record<ModerationAction, ModerationStatus> = {
  approve:  "approved",
  reject:   "rejected",
  hide:     "hidden",
  restore:  "restored",
};

// ── Queue ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/moderation/queue
 * Paginated list of prompts for the moderation queue.
 * All filters applied server-side at query time (stale-result protection).
 */
export const GetModerationQueue = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();

    const {
      status,
      similarityFlag,
      creatorWallet,
      reason,
      since,
      until,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string | undefined>;

    const filter: Record<string, unknown> = {};

    const VALID_STATUSES: ModerationStatus[] = [
      "pending_review", "approved", "rejected", "hidden", "restored",
    ];
    if (status && VALID_STATUSES.includes(status as ModerationStatus)) {
      filter.moderationStatus = status;
    }
    if (similarityFlag) filter.similarityFlag = similarityFlag;
    if (reason) filter.moderationNote = { $regex: reason, $options: "i" };

    if (creatorWallet) {
      // Owner is a User ObjectId reference; look up the user first.
      const User = (await import("../models/User")).default;
      const user = await User.findOne({
        walletAddress: creatorWallet.toLowerCase(),
      }).lean();
      if (user) filter.owner = user._id;
      else return res.json({ prompts: [], page: 1, total: 0, totalPages: 0 });
    }

    if (since || until) {
      const dateFilter: Record<string, Date> = {};
      if (since) dateFilter.$gte = new Date(since);
      if (until) dateFilter.$lte = new Date(until);
      filter.createdAt = dateFilter;
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [prompts, total] = await Promise.all([
      Prompt.find(filter)
        .select(
          "_id onChainId title moderationStatus moderationNote isActive similarityFlag integrityStatus createdAt",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Prompt.countDocuments(filter),
    ]);

    return res.json({
      prompts,
      page: pageNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

// ── Bulk action ───────────────────────────────────────────────────────────────

/**
 * POST /api/moderation/bulk
 * Applies one action to a batch of prompts. Eligible prompts are updated and
 * a ModerationDecision document + AuditLog entry are created for each.
 */
export const BulkModerationAction = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();

    const body = req.body as {
      action?: unknown;
      promptIds?: unknown;
      reason?: unknown;
      evidenceNote?: unknown;
    };

    const VALID_ACTIONS: ModerationAction[] = ["approve", "reject", "hide", "restore"];
    if (!body.action || !VALID_ACTIONS.includes(body.action as ModerationAction)) {
      return res.status(400).json({
        error: `action must be one of: ${VALID_ACTIONS.join(", ")}.`,
      });
    }
    if (!Array.isArray(body.promptIds) || body.promptIds.length === 0) {
      return res.status(400).json({ error: "promptIds must be a non-empty array." });
    }
    if (body.promptIds.length > 100) {
      return res.status(400).json({ error: "promptIds may not exceed 100 items per request." });
    }
    if (!body.reason || typeof body.reason !== "string" || !body.reason.trim()) {
      return res.status(400).json({ error: "reason is required." });
    }

    const action = body.action as ModerationAction;
    const promptIds: string[] = body.promptIds as string[];
    const reason = (body.reason as string).trim();
    const evidenceNote =
      typeof body.evidenceNote === "string" ? body.evidenceNote.trim() || null : null;

    const actorWallet = hashWallet(req.admin?.sub ?? "unknown");
    const eligibleStatuses = ELIGIBLE_STATUSES[action];
    const newStatus = RESULTING_STATUS[action];
    const auditAction = `moderation_${action}` as
      | "moderation_approve"
      | "moderation_reject"
      | "moderation_hide"
      | "moderation_restore";

    // Fetch all candidate prompts in one query — only those with eligible statuses.
    const candidates = await Prompt.find({
      _id: { $in: promptIds },
      moderationStatus: { $in: eligibleStatuses },
    })
      .select("_id onChainId title moderationStatus owner")
      .populate("owner", "walletAddress")
      .lean();

    const eligibleIds = new Set(candidates.map((p) => String(p._id)));
    const skipped = promptIds.length - eligibleIds.size;

    const decisionIds: string[] = [];

    // Apply action to each eligible prompt individually so we can record a
    // per-prompt ModerationDecision and fan-out notifications.
    await Promise.all(
      candidates.map(async (prompt) => {
        const previousStatus = prompt.moderationStatus as ModerationStatus;
        const promptIdStr = String(prompt._id);

        // 1. Update moderationStatus on the Prompt document.
        await Prompt.findByIdAndUpdate(prompt._id, {
          $set: {
            moderationStatus: newStatus,
            lastModeratedAt: new Date(),
          },
        });

        // 2. Create audit evidence record.
        const decision = await ModerationDecision.create({
          promptId: promptIdStr,
          action,
          actorWallet,
          reason,
          evidenceNote,
          previousStatus,
          newStatus,
        });
        decisionIds.push(String(decision._id));

        // 3. Immutable AuditLog entry.
        await recordAuditEvent({
          action: auditAction,
          result: "success",
          promptId: promptIdStr,
          walletAddress: req.admin?.sub ?? null,
          reason: `action=${action} promptId=${promptIdStr} decision=${String(decision._id)}`,
        });

        // 4. In-app notification to prompt owner on hide/restore.
        if (action === "hide" || action === "restore") {
          const ownerWallet = (prompt.owner as { walletAddress?: string } | null)
            ?.walletAddress;
          if (ownerWallet) {
            const title = (prompt as { title?: string }).title ?? promptIdStr;
            await createNotification({
              recipientWallet: ownerWallet,
              type: "moderation_action",
              message:
                action === "hide"
                  ? `Your prompt "${title}" was hidden by a moderator.`
                  : `Your prompt "${title}" has been restored by a moderator.`,
              deepLink: `/prompts/${prompt.onChainId ?? promptIdStr}`,
              promptId: promptIdStr,
              promptTitle: title,
              idempotencyKey: `moderation:${String(decision._id)}`,
            }).catch(() => {
              // Notification failure must not block the moderation action.
            });
          }
        }
      }),
    );

    return res.json({
      action,
      requested: promptIds.length,
      applied: candidates.length,
      skipped,
      decisionIds,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

// ── Decision list ─────────────────────────────────────────────────────────────

/**
 * GET /api/moderation/decisions
 * Paginated list of moderation decisions for audit review.
 */
export const ListModerationDecisions = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();

    const { promptId, actorWallet, action, since, limit = "50" } =
      req.query as Record<string, string | undefined>;

    const filter: Record<string, unknown> = {};
    if (promptId) filter.promptId = promptId;
    if (actorWallet) filter.actorWallet = hashWallet(actorWallet);
    if (action) filter.action = action;
    if (since) filter.createdAt = { $gte: new Date(since) };

    const decisions = await ModerationDecision.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Math.max(1, parseInt(limit, 10))))
      .lean();

    return res.json(decisions);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

// ── Rollback ──────────────────────────────────────────────────────────────────

/**
 * POST /api/moderation/decisions/:id/rollback
 * Reverses a previous decision by restoring `previousStatus` to the Prompt and
 * marking the ModerationDecision as rolled back.
 *
 * The original decision document is never deleted — the rollback is recorded
 * as metadata on it. A new AuditLog entry is created for the rollback itself.
 */
export const RollbackModerationDecision = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();

    const body = req.body as { reason?: unknown };
    if (!body.reason || typeof body.reason !== "string" || !body.reason.trim()) {
      return res.status(400).json({ error: "reason is required for rollback." });
    }

    const decision = await ModerationDecision.findById(req.params.id);
    if (!decision) {
      return res.status(404).json({ error: "Moderation decision not found." });
    }
    if (decision.rolledBack) {
      return res.status(400).json({ error: "This decision has already been rolled back." });
    }

    const rollbackReason = (body.reason as string).trim();
    const now = new Date();

    // Restore the previous status on the Prompt.
    await Prompt.findOneAndUpdate(
      { _id: decision.promptId },
      {
        $set: {
          moderationStatus: decision.previousStatus,
          lastModeratedAt: now,
        },
      },
    );

    // Mark the decision as rolled back.
    await ModerationDecision.findByIdAndUpdate(decision._id, {
      $set: {
        rolledBack: true,
        rollbackReason,
        rollbackAt: now,
      },
    });

    // Audit trail entry for the rollback.
    await recordAuditEvent({
      action: "moderation_rollback",
      result: "success",
      promptId: decision.promptId,
      walletAddress: req.admin?.sub ?? null,
      reason: `rollback decision=${String(decision._id)} reason=${rollbackReason}`,
    });

    return res.json({
      message: "Decision rolled back successfully.",
      restoredStatus: decision.previousStatus,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};
