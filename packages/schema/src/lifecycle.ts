/**
 * Prompt lifecycle state machine — Issue #786.
 *
 * Prompt listing behavior was governed by a mix of independent fields with
 * no shared transition rules: `listingStatus` (draft/ready/published/
 * archived), a separate `moderationStatus` (none/restricted/retired) set
 * ad hoc by the moderation endpoint, and an `isActive` boolean. Nothing
 * prevented, say, moderating a draft, or "publishing" an already-archived
 * listing. This module is the single source of truth for which states
 * exist, which transitions between them are allowed, and who (creator,
 * moderator, or an automated system process) may perform each one.
 *
 * Pure and framework-free by design so it can be imported by the server
 * (to guard writes), the frontend (to derive which UI actions to show),
 * and tests, without pulling in Mongoose or React.
 */

/** All lifecycle states a prompt listing can be in. */
export const LIFECYCLE_STATES = [
  "draft",
  "review",
  "published",
  "hidden",
  "suspended",
  "archived",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/**
 * Who initiated a transition. Kept distinct per state ("Keep moderation
 * actions distinct from creator actions") so, e.g., only a moderator can
 * lift a suspension — a creator cannot self-reinstate a suspended listing.
 */
export type LifecycleActorRole = "creator" | "moderator" | "system";

export interface LifecycleTransition {
  to: LifecycleState;
  /** Roles allowed to perform this transition. */
  allowedRoles: ReadonlyArray<LifecycleActorRole>;
  /** Short label for UI affordances (e.g. a button caption). */
  label: string;
}

/**
 * The full transition table. Read as: from this state, these are the only
 * states reachable, and by whom.
 *
 *   draft ──(creator)──▶ review ──(moderator/system)──▶ published
 *     ▲                     │
 *     │                (creator/moderator: withdraw)
 *     │                     ▼
 *     └──(creator/moderator: restore)── archived        draft
 *
 *   published ──(creator/moderator)──▶ hidden ──(creator/moderator)──▶ published
 *   published ──(moderator)──▶ suspended ──(moderator)──▶ published
 *   published, hidden ──(creator/moderator)──▶ archived
 *   suspended ──(moderator)──▶ archived
 *   archived ──(creator/moderator)──▶ draft   (restore/relist)
 *
 * `archived` and `suspended` are reachable but neither is a dead end:
 * archived can always be restored to draft, and suspended can always be
 * reinstated by a moderator — lifecycle status is reversible by design
 * (see also Issue #787's stale-status reversibility requirement, which
 * this table is written to compose with).
 */
export const LIFECYCLE_TRANSITIONS: Readonly<
  Record<LifecycleState, ReadonlyArray<LifecycleTransition>>
> = {
  draft: [{ to: "review", allowedRoles: ["creator"], label: "Submit for review" }],
  review: [
    { to: "published", allowedRoles: ["moderator", "system"], label: "Approve" },
    { to: "draft", allowedRoles: ["creator", "moderator"], label: "Withdraw / request changes" },
  ],
  published: [
    { to: "hidden", allowedRoles: ["creator", "moderator"], label: "Hide" },
    { to: "suspended", allowedRoles: ["moderator"], label: "Suspend" },
    { to: "archived", allowedRoles: ["creator", "moderator"], label: "Archive" },
  ],
  hidden: [
    { to: "published", allowedRoles: ["creator", "moderator"], label: "Unhide" },
    { to: "archived", allowedRoles: ["creator", "moderator"], label: "Archive" },
  ],
  suspended: [
    { to: "published", allowedRoles: ["moderator"], label: "Reinstate" },
    { to: "archived", allowedRoles: ["moderator"], label: "Archive" },
  ],
  archived: [{ to: "draft", allowedRoles: ["creator", "moderator"], label: "Restore" }],
};

/** States from which a listing is visible in the public marketplace. */
export const PUBLIC_LIFECYCLE_STATES: ReadonlyArray<LifecycleState> = ["published"];

export class LifecycleTransitionError extends Error {
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  readonly actorRole: LifecycleActorRole;

  constructor(from: LifecycleState, to: LifecycleState, actorRole: LifecycleActorRole) {
    super(`Cannot transition prompt lifecycle from "${from}" to "${to}" as ${actorRole}.`);
    this.name = "LifecycleTransitionError";
    this.from = from;
    this.to = to;
    this.actorRole = actorRole;
  }
}

/** The transition definition for `from -> to`, or `null` if not reachable at all (regardless of actor). */
export function findTransition(
  from: LifecycleState,
  to: LifecycleState,
): LifecycleTransition | null {
  return LIFECYCLE_TRANSITIONS[from]?.find((t) => t.to === to) ?? null;
}

/**
 * Whether `actorRole` may move a listing from `from` to `to` right now.
 * Rejects unknown states, self-transitions, transitions not in the table,
 * and transitions the given role isn't authorized to perform.
 */
export function canTransition(
  from: LifecycleState,
  to: LifecycleState,
  actorRole: LifecycleActorRole,
): boolean {
  if (from === to) return false;
  const transition = findTransition(from, to);
  if (!transition) return false;
  return transition.allowedRoles.includes(actorRole);
}

/**
 * Validates a transition, throwing {@link LifecycleTransitionError} when
 * it isn't allowed. Use this at write boundaries so every rejection is
 * uniform and carries enough detail for the caller to explain it to the
 * user ("Invalid lifecycle transitions are rejected consistently").
 */
export function assertTransition(
  from: LifecycleState,
  to: LifecycleState,
  actorRole: LifecycleActorRole,
): void {
  if (!canTransition(from, to, actorRole)) {
    throw new LifecycleTransitionError(from, to, actorRole);
  }
}

/** The set of states reachable from `from` by `actorRole` right now — drives UI action lists. */
export function availableTransitions(
  from: LifecycleState,
  actorRole: LifecycleActorRole,
): ReadonlyArray<LifecycleTransition> {
  return (LIFECYCLE_TRANSITIONS[from] ?? []).filter((t) => t.allowedRoles.includes(actorRole));
}

/**
 * Migration mapping from the legacy, independent status fields
 * (`listingStatus`, `moderationStatus`, `isActive`) to a single
 * {@link LifecycleState}. Moderation takes precedence over the listing
 * status — a restricted/retired prompt is hidden or archived regardless
 * of what `listingStatus` says, mirroring how the old ad hoc checks
 * behaved (moderation always overrode listing visibility).
 *
 * Pure and side-effect-free: existing rows are migrated lazily, by reading
 * through this function, rather than a destructive backfill script.
 */
export function deriveLifecycleState(legacy: {
  listingStatus?: string | null;
  moderationStatus?: string | null;
  isActive?: boolean | null;
}): LifecycleState {
  const moderation = legacy.moderationStatus ?? "none";
  if (moderation === "retired") return "archived";
  if (moderation === "restricted") return "hidden";

  if (legacy.isActive === false) return "hidden";

  switch (legacy.listingStatus) {
    case "draft":
      return "draft";
    // "ready" was the pre-#786 name for a listing awaiting approval.
    case "ready":
      return "review";
    case "published":
      return "published";
    case "archived":
      return "archived";
    default:
      return "draft";
  }
}
