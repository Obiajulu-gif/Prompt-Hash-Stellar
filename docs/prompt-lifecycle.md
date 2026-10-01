# Prompt lifecycle state machine (Issue #786)

Prompt listing behavior used to be governed by three independent fields
that nothing kept in sync:

- `listingStatus`: `draft | ready | published | archived`
- `moderationStatus`: `none | restricted | retired` — set by the
  moderation endpoint, but until this change it was never declared on the
  Mongoose schema, so writes to it were **silently dropped** (default
  `strict: true` strips unknown paths on `$set`).
- `isActive`: a boolean toggled ad hoc alongside the above.

Nothing prevented, say, moderating a draft prompt, or "reinstating" one
that was never restricted. This document describes the explicit state
machine that replaces those scattered checks.

## States

| State       | Meaning                                                         |
| ----------- | ---------------------------------------------------------------- |
| `draft`     | Creator is still editing. Not visible anywhere but the dashboard. |
| `review`    | Submitted, awaiting approval (manual or automated).              |
| `published` | Live in the public marketplace.                                  |
| `hidden`    | Not publicly visible, but not moderated — creator- or moderator-initiated, reversible. |
| `suspended` | Moderator-only visibility block, pending investigation.          |
| `archived`  | Retired. Reachable from any live state; restorable back to `draft`. |

Only `published` is in `PUBLIC_LIFECYCLE_STATES` — every marketplace query
should filter on that set (or `lifecycleState === "published"`), not on
`listingStatus`/`isActive` directly.

## Transition diagram

```
draft ──(creator: submit)──▶ review
  ▲                             │
  │                    (creator/moderator: withdraw)
  │                             ▼
  └───(restore)─── archived   draft

published ──(creator/moderator: hide)────▶ hidden ──(unhide)──▶ published
published ──(moderator: suspend)─────────▶ suspended ──(moderator: reinstate)──▶ published
published, hidden ──(creator/moderator: archive)──▶ archived
suspended ──(moderator: archive)──▶ archived
archived ──(creator/moderator: restore)──▶ draft
```

Full transition table with the exact allowed actor roles lives in
[`packages/schema/src/lifecycle.ts`](../packages/schema/src/lifecycle.ts)
(`LIFECYCLE_TRANSITIONS`) — treat that file as the source of truth; this
diagram is a summary of it.

## Actor roles

- **creator** — the listing's owner. Can submit for review, hide/unhide
  their own published listing, and archive/restore it.
- **moderator** — an admin wallet. Can additionally suspend a listing,
  reinstate a suspended one, and force any creator-level transition. Only
  a moderator can move a listing out of `suspended` — a creator cannot
  self-reinstate ("keep moderation actions distinct from creator
  actions").
- **system** — automated transitions (e.g. an auto-approval job moving
  `review` → `published`). No human wallet is attached.

## Reversibility

Every terminal-looking state is reversible: `archived` can always be
restored to `draft` by the creator or a moderator, and `suspended` can
always be reinstated by a moderator. There is no dead end that requires
recreating a listing from scratch.

## Migration from the legacy fields

`deriveLifecycleState()` in `lifecycle.ts` is a pure function mapping the
three legacy fields to a `LifecycleState`, used once per prompt the first
time it goes through `transitionPromptLifecycle()` (its `lifecycleState`
field starts unset). Moderation status takes precedence over listing
status, matching how the old ad hoc checks behaved:

1. `moderationStatus === "retired"` → `archived`
2. `moderationStatus === "restricted"` → `hidden`
3. `isActive === false` → `hidden`
4. otherwise, `listingStatus` maps directly (`ready` → `review`)

This is intentionally **not** a destructive backfill script — existing
rows migrate lazily, the first time they're written through the new path.
`listingStatus`/`isActive` are still kept in sync by
`transitionPromptLifecycle()` on every write, so any reader that hasn't
migrated to `lifecycleState` yet keeps working.

## Where this is enforced

- `packages/schema/src/lifecycle.ts` — pure state machine (states,
  transitions, `canTransition`/`assertTransition`, the legacy-field
  migration function). No framework dependencies; safe to import from the
  frontend to drive which action buttons are shown.
- `server/src/services/promptLifecycle.ts` — the single write path.
  Validates the transition, updates the prompt document (new
  `lifecycleState`/`lifecycleHistory` fields plus the legacy mirror
  fields), and records an audit event via `recordAuditEvent` — both on
  success and on a rejected transition attempt.
- `api/prompts/moderate.ts` — the moderation endpoint now calls
  `transitionPromptLifecycle()` instead of writing
  `listingStatus`/`moderationStatus` directly, so a moderation action that
  doesn't make sense for the listing's current state (e.g. reinstating a
  listing that was never suspended/restricted) is rejected with `409
  INVALID_STATE` instead of silently corrupting state.

## Tests

`packages/schema/src/lifecycle.test.ts` covers every transition in the
table (allowed for its permitted roles, rejected for every other role)
and every (from, to) pair *not* in the table, plus the legacy-field
migration function.
