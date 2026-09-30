import { describe, it, expect } from "vitest";
import {
  LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  canTransition,
  assertTransition,
  availableTransitions,
  findTransition,
  deriveLifecycleState,
  LifecycleTransitionError,
  type LifecycleState,
  type LifecycleActorRole,
} from "./lifecycle.js";

const ROLES: ReadonlyArray<LifecycleActorRole> = ["creator", "moderator", "system"];

/** Every (from, to) pair actually reachable per the transition table. */
function allowedPairs(): Array<{ from: LifecycleState; to: LifecycleState; roles: ReadonlyArray<LifecycleActorRole> }> {
  const pairs: Array<{ from: LifecycleState; to: LifecycleState; roles: ReadonlyArray<LifecycleActorRole> }> = [];
  for (const from of LIFECYCLE_STATES) {
    for (const transition of LIFECYCLE_TRANSITIONS[from]) {
      pairs.push({ from, to: transition.to, roles: transition.allowedRoles });
    }
  }
  return pairs;
}

/**
 * Legacy record fixture pack (Prompt Hash Stellar).
 *
 * These fixtures are frozen copies of shapes that existed in production
 * before the lifecycle state machine was introduced. They are deliberately
 * inlined (rather than loaded from JSON) so the expected old shape is visible
 * at the callsite and can be diffed reviewed. The `deriveLifecycleState` helper
 * is the compatibility layer that maps these legacy shapes onto current
 * lifecycle states.
 *
 * Provenance:
 *   - cleanLegacyRecord: v1 listing document before `moderationStatus` existed.
 *   - missingFieldRecord: v1 document that never got ``isActive`` backfilled.
 *   - deprecatedFieldRecord: v0 document using the old ``ready`` status and
 *     the deprecated ``legacyId`` field.
 *   - incompatibleLegacyRecord: v0 document with an unknown status and a
  *     moderation flag that no longer exists.
 *
 * Coverage: clean legacy record, missing field, deprecated field, and
 * incompatible legacy record. Each case asserts the migration produces
 * current valid records (a known LifecycleState).
 */

/** V2 current shape: listingStatus + isActive + optional moderationStatus. */
export interface CurrentListingRecord {
  id: string;
  listingStatus: LifecycleState;
  isActive: boolean;
  moderationStatus?: "restricted" | "retired";
}

/** V1 legacy shape: listingStatus only, no moderationStatus. */
export interface LegacyV1Record {
  id: string;
  listingStatus?: string;
  isActive?: boolean;
}

/** V0 legacy shape: old `status` enum + deprecated `moderation`. */
export interface LegacyV0Record {
  id: string;
  status?: string;
  legacyId?: string;
  moderation?: string;
}

/** Known legacy status values from the v0 `status` enum. */
const LEGACY_V1_STATUS_MAP: Readonly<Record<string, LifecycleState>> = {
  draft: "draft",
  ready: "review",
  published: "published",
  archived: "archived",
};

/** Maps a v0/legacy status string onto a current lifecycle state. */
function mapLegacyStatus(status: string | undefined): LifecycleState {
  if (status && status in LEGACY_V1_STATUS_MAP) {
    return LEGACY_V1_STATUS_MAP[status];
  }
  return "draft";
}

/**
 * Migrates a legacy record (v0 or v1) to the current listing record shape.
 * This is the compatibility layer under test.
 */
export function migrateLegacyRecord(
  record: LegacyV0Record | LegacyV1Record,
): CurrentListingRecord {
  const id = record.id;
  const listingStatus = "listingStatus" in record ? record.listingStatus : (record as LegacyV0Record).status;
  const isActive = "isActive" in record ? record.isActive : undefined;
  const moderation = (record as LegacyV0Record).moderation;

  const derived = deriveLifecycleState({
    listingStatus: mapLegacyStatus(listingStatus),
    isActive,
    moderationStatus:
      moderation === "restricted" || moderation === "retired" ? moderation : undefined,
  });

  return {
    id,
    listingStatus: derived,
    isActive: derived === "published",
    moderationStatus:
      moderation === "restricted" || moderation === "retired" ? moderation : undefined,
  };
}

export const LEGACY_FIXTURES: Readonly<Record<string, LegacyV0Record | LegacyV1Record>> = {
  cleanLegacyRecord: {
    id: "listing_1",
    listingStatus: "published",
    isActive: true,
  },
  missingFieldRecord: {
    id: "listing_2",
    listingStatus: "published",
  },
  deprecatedFieldRecord: {
    id: "listing_3",
    status: "ready",
    legacyId: "legacy-listing-3",
  },
  incompatibleLegacyRecord: {
    id: "listing_4",
    status: "quarantined",
    moderation: "restricted",
  },
};

describe("prompt lifecycle state machine (Issue #786)", () => {
  describe("every allowed transition", () => {
    for (const { from, to, roles } of allowedPairs()) {
      for (const role of roles) {
        it(`allows ${from} -> ${to} for ${role}`, () => {
          expect(canTransition(from, to, role)).toBe(true);
          expect(() => assertTransition(from, to, role)).not.toThrow();
        });
      }

      const disallowedRoles = ROLES.filter((r) => !roles.includes(r));
      for (const role of disallowedRoles) {
        it(`rejects ${from} -> ${to} for unauthorized role ${role}`, () => {
          expect(canTransition(from, to, role)).toBe(false);
          expect(() => assertTransition(from, to, role)).toThrow(LifecycleTransitionError);
        });
      }
    }
  });

  describe("every rejected transition (pair not in the table at all)", () => {
    const allowed = new Set(allowedPairs().map((p) => `${p.from}->${p.to}`));

    for (const from of LIFECYCLE_STATES) {
      for (const to of LIFECYCLE_STATES) {
        if (from === to) {
          it(`rejects self-transition ${from} -> ${to} for every role`, () => {
            for (const role of ROLES) {
              expect(canTransition(from, to, role)).toBe(false);
            }
          });
          continue;
        }
        if (allowed.has(`${from}->${to}`)) continue; // covered above

        it(`rejects unreachable ${from} -> ${to} for every role`, () => {
          for (const role of ROLES) {
            expect(canTransition(from, to, role)).toBe(false);
          }
        });
      }
    }
  });

  describe("assertTransition", () => {
    it("throws LifecycleTransitionError carrying from/to/actorRole", () => {
      try {
        assertTransition("draft", "published", "creator");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(LifecycleTransitionError);
        const e = err as LifecycleTransitionError;
        expect(e.from).toBe("draft");
        expect(e.to).toBe("published");
        expect(e.actorRole).toBe("creator");
        expect(e.message).toContain("draft");
        expect(e.message).toContain("published");
      }
    });
  });

  describe("findTransition", () => {
    it("returns the transition definition when reachable", () => {
      const t = findTransition("draft", "review");
      expect(t?.to).toBe("review");
      expect(t?.allowedRoles).toContain("creator");
    });

    it("returns null when not reachable", () => {
      expect(findTransition("draft", "published")).toBeNull();
    });
  });

  describe("availableTransitions", () => {
    it("only creator actions are offered a creator from published", () => {
      const options = availableTransitions("published", "creator").map((t) => t.to);
      expect(options.sort()).toEqual(["archived", "hidden"]);
      // Creators cannot suspend their own listing.
      expect(options).not.toContain("suspended");
    });

    it("moderators additionally see suspend from published", () => {
      const options = availableTransitions("published", "moderator").map((t) => t.to);
      expect(options).toContain("suspended");
    });

    it("returns an empty list for a role with no legal transitions from this state", () => {
      // Only a moderator may reinstate/archive a suspended listing.
      expect(availableTransitions("suspended", "creator")).toEqual([]);
    });
  });

  describe("reversibility", () => {
    it("archived can always be restored back to draft", () => {
      expect(canTransition("archived", "draft", "creator")).toBe(true);
      expect(canTransition("archived", "draft", "moderator")).toBe(true);
    });

    it("suspended can always be reinstated by a moderator", () => {
      expect(canTransition("suspended", "published", "moderator")).toBe(true);
    });

    it("suspended cannot be reinstated by the creator (moderation actions stay distinct)", () => {
      expect(canTransition("suspended", "published", "creator")).toBe(false);
    });
  });

  describe("deriveLifecycleState (legacy field migration)", () => {
    it("maps a fresh draft", () => {
      expect(deriveLifecycleState({ listingStatus: "draft" })).toBe("draft");
    });

    it("maps the legacy 'ready' status to 'review'", () => {
      expect(deriveLifecycleState({ listingStatus: "ready" })).toBe("review");
    });

    it("maps published straight through", () => {
      expect(deriveLifecycleState({ listingStatus: "published", isActive: true })).toBe("published");
    });

    it("maps archived straight through", () => {
      expect(deriveLifecycleState({ listingStatus: "archived" })).toBe("archived");
    });

    it("an inactive published listing derives as hidden", () => {
      expect(deriveLifecycleState({ listingStatus: "published", isActive: false })).toBe("hidden");
    });

    it("moderationStatus 'restricted' overrides listingStatus/isActive to hidden", () => {
      expect(
        deriveLifecycleState({ listingStatus: "published", isActive: true, moderationStatus: "restricted" }),
      ).toBe("hidden");
    });

    it("moderationStatus 'retired' overrides listingStatus/isActive to archived", () => {
      expect(
        deriveLifecycleState({ listingStatus: "published", isActive: true, moderationStatus: "retired" }),
      ).toBe("archived");
    });

    it("defaults to draft for an unrecognized/missing listingStatus", () => {
      expect(deriveLifecycleState({})).toBe("draft");
      expect(deriveLifecycleState({ listingStatus: "something-unexpected" })).toBe("draft");
    });
  });

  describe("legacy fixture pack (Prompt Hash Stellar)", () => {
    it("exposes all four required fixture cases", () => {
      expect(Object.keys(LIFECYCLE_FIXTURES).sort()).toEqual([
        "cleanLegacyRecord",
        "deprecatedFieldRecord",
        "incompatibleLegacyRecord",
        "missingFieldRecord",
      ]);
    });

    it("clean legacy record migrates to a valid current record", () => {
      const migrated = migrateLegacyRecord(LEGACY_FIXTURES.cleanLegacyRecord);
      expect(migrated.id).toBe("listing_1");
      expect(migrated.listingStatus).toBe("published");
      expect(migrated.isActive).toBe(true);
      expect(LIFECYCLE_STATES).toContain(migrated.listingStatus);
    });

    it("missing field record defaults to a valid current record", () => {
      const migrated = migrateLegacyRecord(LEGACY_FIXTURES.missingFieldRecord);
      expect(migrated.id).toBe("listing_2");
      expect(migrated.listingStatus).toBe("hidden");
      expect(migrated.isActive).toBe(false);
      expect(LIFECYCLE_STATES).toContain(migrated.listingStatus);
    });

    it("deprecated field record maps the legacy 'ready' status to 'review'", () => {
      const migrated = migrateLegacyRecord(LEGACY_FIXTURES.deprecatedFieldRecord);
      expect(migrated.id).toBe("listing_3");
      expect(migrated.listingStatus).toBe("review");
      expect(migrated.isActive).toBe(false);
      expect(migrated.moderationStatus).toBeUndefined();
    });

    it("incompatible legacy record migrates to a valid current record", () => {
      const migrated = migrateLegacyRecord(LEGACY_FIXTURES.incompatibleLegacyRecord);
      expect(migrated.id).toBe("listing_4");
      expect(migrated.listingStatus).toBe("hidden");
      expect(migrated.isActive).toBe(false);
      expect(migrated.moderationStatus).toBe("restricted");
    });

    it("every migrated record is a current valid record", () => {
      for (const fixture of Object.values(LEGACY_FIXTURES)) {
        const migrated = migrateLegacyRecord(fixture);
        expect(typeof migrated.id).toBe("string");
        expect(LIFECYCLE_STATES).toContain(migrated.listingStatus);
        expect(typeof migrated.isActive).toBe("boolean");
      }
    });
  });
})
