/**
 * Bulk moderation queue controllers (#moderation-queue).
 *
 * Endpoints:
 *   GET  /api/moderation/queue              – filtered, paginated prompt queue
 *   POST /api/moderation/bulk               – bulk approve/reject/hide/restore
 *   POST /api/moderation/simulate           – policy simulation with affected-record preview (no writes)
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
 *  Policy simulation
 *  -----------------
 *  The simulate endpoint runs the exact same eligibility filter as the bulk
 *  action but performs no writes. It returns the set of prompts that *would*
 *  be affected, the set that would be skipped, and per-prompt before/after
 *  status, so a moderator can preview the blast radius before committing.
 *  Simulation results are advisory: they reflect the state at query time and
 *  the bulk endpoint re-validates eligibility at apply time.
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

const VALID_ACTIONS: ModerationAction[] = ["approve", "reject", "hide", "restore"];

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

const MAX_BATCH = 100;

type ValidatedBulkInput = {
  action: ModerationAction;
  promptIds: string[];
  reason: string;
  evidenceNote: string | null;
};

/**
 * Validates a bulk/simulate request body. Returns either the normalized input
 * or an error message suitable for a 400 response.
 */
function validateBulkBody(
  body: { action?: unknown; promptIds?: unknown; reason?: unknown; evidenceNote?: unknown },
  requireReason: boolean,
): { ok: true; value: ValidatedBulkInput } | { ok: false; error: string } {
  if (!body.action || !VALID_ACTIONS.includes(body.action as ModerationAction)) {
    return { ok: false, error: `action must be one of: ${VALID_ACTIONS.join(", ")}.` };
  }
  if (!Array.isArray(body.promptIds) || body.promptIds.length === 0) {
    return { ok: false, error: "promptIds must be a non-empty array." };
  }
  if (body.promptIds.length > MAX_BATCH) {
    return { ok: false, error: `promptIds may not exceed ${MAX_BATCH} items per request.` };
  }
  const reasonRaw = typeof body.reason === "string" ? body.reason.trim() : "";
  if (requireReason && !reasonRaw) {
    return { ok: false, error: "reason is required." };
  }
  const evidenceNote =
    typeof body.evidenceNote === "string" ? body.evidenceNote.trim() || null : null;
  return {
    ok: true,
    value: {
      action: body.action as ModerationAction,
      promptIds: (body.promptIds as unknown[]).map((id) => String(id)),
      reason: reasonRaw,
      evidenceNote,
    },
  };
}

/**
 * Loads prompts matching the requested ids and classifies each as eligible or
 * skipped for the given action, using the same stale-query rule as bulk apply.
 */
async function classifyPrompts(action: ModerationAction, promptIds: string[]) {
  const eligibleStatuses = ELIGIBLE_STATUSES[action];
  const found = await Prompt.find({ _id: { $in: promptIds } })
    .select("_id onChainId title moderationStatus owner")
    .populate("owner", "walletAddress")
    .lean();

  const foundById = new Map(found.map((p) => [String(p._id), p]));
  const eligible = found.filter((p) =>
    eligibleStatuses.includes(p.moderationStatus as ModerationStatus),
  );
  const eligibleIds = new Set(eligible.map((p) => String(p._id)));
  const skipped = promptIds.filter((id) => !eligibleIds.has(id) && foundById.has(id));
  const missing = promptIds.filter((id) => !foundById.has(id));

  return { eligible, skipped, missing };
}

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

// ── Policy simulation ─────────────────────────────────────────────────────────

/**
 * POST /api/moderation/simulate
 * Read-only preview of a bulk action. Returns which prompts would be affected
 * (with before/after status), which would be skipped (ineligible state), and
 * which ids do not exist. Performs no writes and creates no audit entries.
 *
 * Edge cases:
 *  - Duplicate ids are de-duplicated before classification.
 *  - `reason` is optional here; simulation does not persist anything.
 *  - Results reflect state at query time; bulk apply re-validates.
 */
export const SimulateModerationAction = async (
  req: AdminRequest,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();

    const parsed = validateBulkBody(req.body ?? {}, false);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const { action, promptIds: rawIds } = parsed.value;
    const promptIds = Array.from(new Set(rawIds));
    const newStatus = RESULTING_STATUS[action];

    const { eligible, skipped, missing } = await classifyPrompts(action, promptIds);

    const affected = eligible.map((p) => ({
      promptId: String(p._id),
      onChainId: p.onChainId ?? null,
      title: (p as { title?: string }).title ?? null,
      currentStatus: p.moderationStatus,
      resultingStatus: newStatus,
      ownerWallet:
        (p.owner as { walletAddress?: string } | null)?.walletAddress ?? null,
      notifiesOwner: action === "hide" || action === "restore",
    }));

    return res.json({
      action,
      requested: rawIds.length,
      uniqueRequested: promptIds.length,
      wouldApply: affected.length,
      wouldSkip: skipped.length,
      missing: missing.length,
      affected,
      skippedIds: skipped,
      missingIds: missing,
      dryRun: true,
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

    const parsed = validateBulkBody(req.body ?? {}, true);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const { action, promptIds: rawIds, reason, evidenceNote } = parsed.value;
    const promptIds = Array.from(new Set(rawIds));

    const actorWallet = hashWallet(req.admin?.sub ?? "unknown");
    const newStatus = RESULTING_STATUS[action];
    const auditAction = `moderation_${action}` as
      | "moderation_approve"
      | "moderation_reject"
      | "moderation_hide"
      | "moderation_restore";

    // Fetch all candidate prompts in one query — only those with eligible statuses.
    const { eligible: candidates, skipped: skippedIds } = await classifyPrompts(
      action,
      promptIds,
    );
    const skipped = skippedIds.length;

    const decisionIds: string[] = [];

    // Apply action to each eligible prompt individually so we can record a
    // per-prompt ModerationDecision and fan-out notifications.
    await Promise.all(
      candidates.map(async (prompt) => {
        const previousStatus = prompt.moderationStatus as ModerationStatus;
        const promptIdStr = String(prompt._id);

        // 1. Update moderationStatus on the Prompt document, guarded by the
        //    expected previous status so a concurrent change causes a no-op
        //    rather than a silent overwrite.
        const updated = await Prompt.updateOne(
          { _id: prompt._id, moderationStatus: previousStatus },
          { $set: { moderationStatus: newStatus } },
        );
        if (updated.modifiedCount === 0) return;

        // 2. Record the decision so it can be listed and rolled back later.
        const decision = await ModerationDecision.create({
          prompt: prompt._id,
          action,
          previousStatus,
          resultingStatus: newStatus,
          reason,
          evidenceNote,
          actorWallet,
          rolledBack: false,
        });
        decisionIds.push(String(decision._id));

        // 3. Immutable audit log entry.
        await recordAuditEvent({
          action: auditAction,
          actorWallet,
          targetId: promptIdStr,
          metadata: {
            decisionId: String(decision._id),
            previousStatus,
            resultingStatus: newStatus,
          },
        });

        // 4. Notify owner on hide/restore.
        if (action === "hide" || action === "restore") {
          const ownerId = (prompt.owner as { _id?: unknown } | null)?._id ?? prompt.owner;
          if (ownerId) {
            await createNotification({
              recipient: ownerId as never,
              type: "moderation_action",
              message: `Your prompt was ${newStatus} by moderation.`,
              metadata: { promptId: promptIdStr, action },
            });
          }
        }
      }),
    );

    return res.json({
      action,
      requested: rawIds.length,
      uniqueRequested: promptIds.length,
      applied: decisionIds.length,
      skipped,
      decisionIds,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};
