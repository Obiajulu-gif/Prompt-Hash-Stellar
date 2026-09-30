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

/**
 * Legacy fixture pack — Issue #788.
 *
 * Before #786, prompt listings were persisted with three independent
 * fields (`listingStatus`, `moderationStatus`, `isActive`) and no shared
 * state machine. Migrations and compatibility layers need to be tested
 * against realistic old shapes, including malformed rows that predate any
 * validation. This section defines:
 *
 *   - {@link LegacyPromptRecord} — the union of known previous schemas.
 *   - {@link LEGACY_FIXTURES} — a curated, provenance-documented pack
 *     covering clean, missing-field, deprecated-field, and incompatible
 *     legacy records.
 *   - {@link validateLegacyFixture} — asserts a fixture matches one of the
 *     accepted old shapes.
 *   - {@link migrateLegacyRecord} — produces a current, valid record.
 *
 * Fixtures are pure data so they can be reused by server migration tests,
 * frontend compatibility shims, and the API contract suite without
 * pulling in a database driver.
 */

/** The set of `listingStatus` values observed in legacy rows. */
export const LEGACY_LISTING_STATUSES = ["draft", "ready", "published", "archived"] as const;
export type LegacyListingStatus = (typeof LEGACY_LISTING_STATUSES)[number];

/** The set of `moderationStatus` values observed in legacy rows. */
export const LEGACY_MODERATION_STATUSES = ["none", "restricted", "retired"] as const;
export type LegacyModerationStatus = (typeof LEGACY_MODERATION_STATUSES)[number];

/**
 * A legacy prompt record as persisted before #786. Fields are optional
 * because older rows may predate any of them; `id` is always present.
 */
export interface LegacyPromptRecord {
  id: string;
  listingStatus?: string | null;
  moderationStatus?: string | null;
  isActive?: boolean | null;
  /** Deprecated pre-#786 field; superseded by `moderationStatus`. */
  flagged?: boolean | null;
  /** Deprecated pre-#786 field; superseded by `listingStatus`. */
  visible?: boolean | null;
  createdAt?: string;
  updatedAt?: string;
}

/** A current, post-#786 prompt record produced by {@link migrateLegacyRecord}. */
export interface CurrentPromptRecord {
  id: string;
  lifecycleState: LifecycleState;
  /** Always `true` for migrated records; visibility is derived from state. */
  isActive: boolean;
  migratedFrom: "legacy";
}

export type LegacyFixtureKind =
  | "clean"
  | "missing-field"
  | "deprecated-field"
  | "incompatible";

export interface LegacyFixture {
  /** Stable identifier used by tests and migration logs. */
  name: string;
  /** Which acceptance-criteria bucket this fixture exercises. */
  kind: LegacyFixtureKind;
  /** Where the shape was observed (issue, PR, or production sample). */
  provenance: string;
  /** What this fixture is intended to cover. */
  coverage: string;
  /** The raw legacy record. */
  record: LegacyPromptRecord;
}

/**
 * Curated fixture pack. Each entry documents its provenance and the
 * coverage it provides so reviewers can audit migration behavior without
 * reverse-engineering the shapes.
 */
export const LEGACY_FIXTURES: ReadonlyArray<LegacyFixture> = [
  {
    name: "clean-published",
    kind: "clean",
    provenance: "Pre-#786 production sample, prompt marketplace listing export (2024-11).",
    coverage: "Well-formed legacy row with all three status fields populated.",
    record: {
      id: "legacy-clean-published",
      listingStatus: "published",
      moderationStatus: "none",
      isActive: true,
      createdAt: "2024-11-01T00:00:00.000Z",
      updatedAt: "2024-11-02T00:00:00.000Z",
    },
  },
  {
    name: "clean-draft",
    kind: "clean",
    provenance: "Pre-#786 production sample, creator dashboard draft (2024-10).",
    coverage: "Well-formed legacy draft row.",
    record: {
      id: "legacy-clean-draft",
      listingStatus: "draft",
      moderationStatus: "none",
      isActive: true,
    },
  },
  {
    name: "missing-listing-status",
    kind: "missing-field",
    provenance: "Pre-#786 row written before `listingStatus` was introduced.",
    coverage: "Missing `listingStatus`; migration must fall back to `draft`.",
    record: {
      id: "legacy-missing-listing-status",
      moderationStatus: "none",
      isActive: true,
    },
  },
  {
    name: "missing-moderation-status",
    kind: "missing-field",
    provenance: "Pre-#786 row written before `moderationStatus` was introduced.",
    coverage: "Missing `moderationStatus`; treated as `none`.",
    record: {
      id: "legacy-missing-moderation-status",
      listingStatus: "ready",
      isActive: true,
    },
  },
  {
    name: "deprecated-flagged",
    kind: "deprecated-field",
    provenance: "Pre-#786 row using the deprecated `flagged` boolean.",
    coverage: "Deprecated `flagged` field is ignored; `moderationStatus` wins.",
    record: {
      id: "legacy-deprecated-flagged",
      listingStatus: "published",
      moderationStatus: "none",
      isActive: true,
      flagged: true,
    },
  },
  {
    name: "deprecated-visible",
    kind: "deprecated-field",
    provenance: "Pre-#786 row using the deprecated `visible` boolean.",
    coverage: "Deprecated `visible` field is ignored; `isActive`/state wins.",
    record: {
      id: "legacy-deprecated-visible",
      listingStatus: "published",
      moderationStatus: "none",
      isActive: true,
      visible: false,
    },
  },
  {
    name: "incompatible-unknown-listing-status",
    kind: "incompatible",
    provenance: "Corrupt row with an unrecognized `listingStatus` value.",
    coverage: "Unknown `listingStatus` must not throw; falls back to `draft`.",
    record: {
      id: "legacy-incompatible-listing-status",
      listingStatus: "totally-unknown",
      moderationStatus: "none",
      isActive: true,
    },
  },
  {
    name: "incompatible-unknown-moderation-status",
    kind: "incompatible",
    provenance: "Corrupt row with an unrecognized `moderationStatus` value.",
    coverage: "Unknown `moderationStatus` is treated as `none`.",
    record: {
      id: "legacy-incompatible-moderation-status",
      listingStatus: "published",
      moderationStatus: "mystery",
      isActive: true,
    },
  },
];

/**
 * Validates that `record` matches one of the accepted legacy shapes.
 * Returns a list of human-readable problems; empty means valid.
 *
 * "Valid" here means: `id` is a non-empty string, and any present
 * `listingStatus`/`moderationStatus` values are strings (unknown values
 * are tolerated — they are handled by {@link migrateLegacyRecord}).
 */
export function validateLegacyFixture(record: LegacyPromptRecord): ReadonlyArray<string> {
  const problems: string[] = [];
  if (typeof record.id !== "string" || record.id.length === 0) {
    problems.push("legacy record is missing a non-empty `id`");
  }
  if (record.listingStatus != null && typeof record.listingStatus !== "string") {
    problems.push("`listingStatus` must be a string when present");
  }
  if (record.moderationStatus != null && typeof record.moderationStatus !== "string") {
    problems.push("`moderationStatus` must be a string when present");
  }
  if (record.isActive != null && typeof record.isActive !== "boolean") {
    problems.push("`isActive` must be a boolean when present");
  }
  return problems;
}

/**
 * Migrates a legacy record to the current shape. Pure and total: any
 * legacy shape (including incompatible ones) produces a valid current
 * record, mirroring the lazy read-through migration in
 * {@link deriveLifecycleState}.
 */
export function migrateLegacyRecord(record: LegacyPromptRecord): CurrentPromptRecord {
  const lifecycleState = deriveLifecycleState({
    listingStatus: record.listingStatus,
    moderationStatus: record.moderationStatus,
    isActive: record.isActive,
  });
  return {
    id: record.id,
    lifecycleState,
    isActive: true,
    migratedFrom: "legacy",
  };
}
