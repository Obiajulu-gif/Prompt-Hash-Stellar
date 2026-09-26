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
});
