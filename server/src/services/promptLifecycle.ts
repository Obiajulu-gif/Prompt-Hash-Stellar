/**
 * Prompt lifecycle transitions — Issue #786.
 *
 * The single write path for moving a prompt listing between lifecycle
 * states. Every caller (creator-facing publish/hide/archive endpoints,
 * the moderation endpoint) should go through {@link transitionPromptLifecycle}
 * instead of writing `listingStatus`/`moderationStatus`/`isActive`
 * directly, so every transition is validated against the same rules and
 * recorded the same way.
 */
import {
  assertTransition,
  deriveLifecycleState,
  LifecycleTransitionError,
  type LifecycleActorRole,
  type LifecycleState,
} from "@prompthash/schema";
import Prompt from "../models/Prompt";
import { recordAuditEvent } from "./auditTrail";

export interface LifecycleActor {
  role: LifecycleActorRole;
  /** Wallet address for a creator/moderator, or null for an automated system actor. */
  id: string | null;
}

export interface TransitionPromptLifecycleParams {
  /** Mongo `_id` or `onChainId` — whichever the caller already has. */
  promptId: string;
  by: "id" | "onChainId";
  to: LifecycleState;
  actor: LifecycleActor;
  reason?: string | null;
  requestId?: string | null;
  clientIp?: string | null;
  /** Set alongside the transition when it's a moderation action (Issue #786). */
  moderation?: {
    status: "none" | "restricted" | "retired";
    reasonCode: string;
    notes?: string;
  } | null;
}

export class PromptNotFoundError extends Error {
  constructor(promptId: string) {
    super(`Prompt "${promptId}" not found.`);
    this.name = "PromptNotFoundError";
  }
}

/**
 * `listingStatus` values kept in sync for readers that haven't migrated to
 * `lifecycleState` yet (Issue #786 technical note: "plan migration from
 * existing status fields" — additive, not destructive).
 */
const LEGACY_LISTING_STATUS: Record<LifecycleState, string> = {
  draft: "draft",
  review: "ready",
  published: "published",
  hidden: "published", // hidden is a visibility overlay, not a distinct legacy bucket
  suspended: "published",
  archived: "archived",
};

/**
 * Applies a validated lifecycle transition to a prompt: checks the
 * transition is legal for the given actor role, persists the new state
 * (plus the legacy mirror fields other code still reads), appends to
 * `lifecycleHistory`, and records an audit event either way.
 *
 * Throws {@link PromptNotFoundError} or {@link LifecycleTransitionError} on
 * failure — both after having recorded a denial audit event for the
 * latter, so rejected attempts are still visible in the audit trail.
 */
export async function transitionPromptLifecycle(params: TransitionPromptLifecycleParams) {
  const {
    promptId,
    by,
    to,
    actor,
    reason = null,
    requestId = null,
    clientIp = null,
    moderation = null,
  } = params;

  const query = by === "id" ? { _id: promptId } : { onChainId: promptId };
  const prompt = await Prompt.findOne(query);
  if (!prompt) {
    throw new PromptNotFoundError(promptId);
  }

  const from: LifecycleState =
    prompt.lifecycleState ??
    deriveLifecycleState({
      listingStatus: prompt.listingStatus,
      moderationStatus: prompt.moderationStatus,
      isActive: prompt.isActive,
    });

  try {
    assertTransition(from, to, actor.role);
  } catch (err) {
    if (err instanceof LifecycleTransitionError) {
      await recordAuditEvent({
        action: "prompt_lifecycle_transition_denied",
        result: "blocked",
        promptId: String(prompt.onChainId ?? prompt._id),
        walletAddress: actor.id,
        requestId,
        clientIp,
        reason: `${from}->${to} denied for role=${actor.role}`,
      });
    }
    throw err;
  }

  const now = new Date();
  prompt.lifecycleState = to;
  prompt.lifecycleUpdatedAt = now;
  prompt.lifecycleUpdatedBy = actor.id ?? "system";
  prompt.listingStatus = LEGACY_LISTING_STATUS[to];
  prompt.isActive = to !== "hidden" && to !== "suspended" && to !== "archived";
  prompt.lifecycleHistory.push({
    from,
    to,
    actorRole: actor.role,
    actorId: actor.id,
    reason,
    at: now,
  });

  if (moderation) {
    prompt.moderationStatus = moderation.status;
    prompt.moderatedAt = now;
    prompt.moderatedBy = actor.id;
    prompt.moderationReason = moderation.reasonCode;
    prompt.moderationNotes = moderation.notes ?? "";
  }

  await prompt.save();

  await recordAuditEvent({
    action: "prompt_lifecycle_transition",
    result: "success",
    promptId: String(prompt.onChainId ?? prompt._id),
    walletAddress: actor.id,
    requestId,
    clientIp,
    reason: reason ? `${from}->${to}: ${reason}` : `${from}->${to}`,
  });

  return prompt;
}
