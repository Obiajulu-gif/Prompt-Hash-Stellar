/**
 * Tests — conflict resolution for concurrent edits (#1170).
 *
 * Coverage:
 *  - clean merges: no change, one-sided change, non-overlapping concurrent
 *    changes, and both sides making the identical change;
 *  - conflicts: overlapping replacements, same-point insertions, multiple
 *    conflicts, marker shape and base line numbers;
 *  - resolution and retry: prefer_mine, prefer_theirs, and per-conflict
 *    resolutions by index (including a partial first pass);
 *  - failure modes: invalid content, sizes, versions, strategy, resolution
 *    index;
 *  - authorization: only the owning wallet may resolve (case-insensitive),
 *    missing identity is refused;
 *  - HTTP contract: 200 for clean/merged/conflict, 400 for validation, 401/403
 *    for authorization.
 */

import { describe, expect, it } from "vitest";
import {
  EditConflictError,
  MAX_EDIT_BYTES,
  MAX_EDIT_LINES,
  assertCanResolveEdits,
  editConflictRemedy,
  resolveEditConflict,
} from "../services/editConflictResolver";
import { ResolveEditConflict } from "../controllers/editConflictControllers";

function edit(content: string, version = 1) {
  return { content, version };
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.json = (body: unknown) => ((res.body = body), res);
  return res;
}

// ── clean paths ──────────────────────────────────────────────────────────────

describe("clean merges", () => {
  it("returns clean when nobody changed the base", () => {
    const result = resolveEditConflict({
      base: edit("a\nb\nc", 1),
      mine: edit("a\nb\nc", 1),
      theirs: edit("a\nb\nc", 1),
    });
    expect(result.status).toBe("clean");
    expect(result.resolved).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.content).toBe("a\nb\nc");
    expect(result.conflicts).toHaveLength(0);
  });

  it("takes the only side that changed", () => {
    const mineOnly = resolveEditConflict({
      base: edit("a\nb\nc"),
      mine: edit("a\nB\nc"),
      theirs: edit("a\nb\nc"),
    });
    expect(mineOnly.status).toBe("merged");
    expect(mineOnly.content).toBe("a\nB\nc");

    const theirsOnly = resolveEditConflict({
      base: edit("a\nb\nc"),
      mine: edit("a\nb\nc"),
      theirs: edit("a\nb\nC"),
    });
    expect(theirsOnly.status).toBe("merged");
    expect(theirsOnly.content).toBe("a\nb\nC");
  });

  it("applies non-overlapping concurrent edits together", () => {
    const result = resolveEditConflict({
      base: edit("one\ntwo\nthree\nfour\nfive", 2),
      mine: edit("one\nTWO\nthree\nfour\nfive", 3),
      theirs: edit("one\ntwo\nthree\nFOUR\nfive", 3),
    });
    expect(result.status).toBe("merged");
    expect(result.resolved).toBe(true);
    expect(result.content).toBe("one\nTWO\nthree\nFOUR\nfive");
    expect(result.conflicts).toHaveLength(0);
  });

  it("collapses an identical change made by both sides", () => {
    const result = resolveEditConflict({
      base: edit("a\nb\nc"),
      mine: edit("a\nB\nc"),
      theirs: edit("a\nB\nc"),
    });
    expect(result.status).toBe("merged");
    expect(result.content).toBe("a\nB\nc");
    expect(result.conflicts).toHaveLength(0);
  });

  it("is deterministic for the same input", () => {
    const input = {
      base: edit("a\nb\nc"),
      mine: edit("a\nM\nc"),
      theirs: edit("a\nT\nc"),
    };
    expect(resolveEditConflict(input)).toEqual(resolveEditConflict(input));
  });

  it("applies a pure insertion from one side", () => {
    const result = resolveEditConflict({
      base: edit("a\nb"),
      mine: edit("a\ninserted\nb"),
      theirs: edit("a\nb"),
    });
    expect(result.status).toBe("merged");
    expect(result.content).toBe("a\ninserted\nb");
  });
});

// ── conflicts ────────────────────────────────────────────────────────────────

describe("conflicts", () => {
  it("reports an overlapping replacement as a conflict with base line numbers", () => {
    const result = resolveEditConflict({
      base: edit("a\nb\nc", 4),
      mine: edit("a\nMINE\nc", 5),
      theirs: edit("a\nTHEIRS\nc", 6),
    });

    expect(result.status).toBe("conflict");
    expect(result.resolved).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toEqual(
      expect.objectContaining({
        index: 0,
        baseStartLine: 2,
        mineLines: ["MINE"],
        theirsLines: ["THEIRS"],
        resolvedWith: null,
      }),
    );
    expect(result.content).toContain("<<<<<<< mine (v5)");
    expect(result.content).toContain("MINE");
    expect(result.content).toContain("=======");
    expect(result.content).toContain("THEIRS");
    expect(result.content).toContain(">>>>>>> theirs (v6)");
  });

  it("treats different insertions at the same point as a conflict", () => {
    const result = resolveEditConflict({
      base: edit("a\nb"),
      mine: edit("a\nMINE\nb"),
      theirs: edit("a\nTHEIRS\nb"),
    });
    expect(result.status).toBe("conflict");
    expect(result.conflicts).toHaveLength(1);
  });

  it("reports multiple independent conflicts", () => {
    const result = resolveEditConflict({
      base: edit("1\n2\n3\n4\n5\n6\n7"),
      mine: edit("1\nM2\n3\n4\n5\nM6\n7"),
      theirs: edit("1\nT2\n3\n4\n5\nT6\n7"),
    });
    expect(result.status).toBe("conflict");
    expect(result.conflicts).toHaveLength(2);
    expect(result.conflicts.map((conflict) => conflict.baseStartLine)).toEqual([2, 6]);
  });
});

// ── transitive overlap groups (#1170 regression) ─────────────────────────────
// A single replacement on one side can overlap several hunks on the other.
// The whole overlap must be one conflict spanning the union, and each side
// must be reconstructed across that full span so no edit leaks out and no
// unchanged base line between hunks is lost.

describe("transitive overlap groups", () => {
  const maintainerExample = {
    base: edit("A\nB\nC\nD\nE", 5),
    mine: edit("a\nB\nc\nD\nE", 5),
    theirs: edit("X\nE", 6),
  };

  it("resolves the maintainer example with prefer_theirs to X/E", () => {
    const result = resolveEditConflict({
      ...maintainerExample,
      strategy: "prefer_theirs",
    });

    expect(result.status).toBe("merged");
    expect(result.resolved).toBe(true);
    expect(result.content).toBe("X\nE");
    expect(result.stats.conflictCount).toBe(1);
    expect(result.conflicts[0].resolvedWith).toBe("theirs");
  });

  it("resolves the maintainer example with prefer_mine to the full mine edit", () => {
    const result = resolveEditConflict({
      ...maintainerExample,
      strategy: "prefer_mine",
    });

    expect(result.status).toBe("merged");
    expect(result.resolved).toBe(true);
    expect(result.content).toBe("a\nB\nc\nD\nE");
    expect(result.stats.conflictCount).toBe(1);
    expect(result.conflicts[0].resolvedWith).toBe("mine");
  });

  it("keeps several hunks from one side in one conflict against one replacement", () => {
    const base = "one\ntwo\nthree\nfour\nfive\nsix\nseven";
    const mine = "one\nTWO\nthree\nfour\nfive\nSIX\nseven";
    const theirs = "replacement";

    const preferMine = resolveEditConflict({
      base: edit(base),
      mine: edit(mine),
      theirs: edit(theirs),
      strategy: "prefer_mine",
    });
    expect(preferMine.stats.conflictCount).toBe(1);
    // Unchanged base lines between the two hunks survive on the mine side.
    expect(preferMine.content).toBe(mine);

    const preferTheirs = resolveEditConflict({
      base: edit(base),
      mine: edit(mine),
      theirs: edit(theirs),
      strategy: "prefer_theirs",
    });
    expect(preferTheirs.stats.conflictCount).toBe(1);
    expect(preferTheirs.content).toBe(theirs);
  });

  it("preserves unchanged base lines between hunks in manual mode", () => {
    const result = resolveEditConflict(maintainerExample);

    expect(result.status).toBe("conflict");
    expect(result.resolved).toBe(false);
    expect(result.stats.conflictCount).toBe(1);
    expect(result.conflicts[0].mineLines).toEqual(["a", "B", "c", "D"]);
    expect(result.conflicts[0].theirsLines).toEqual(["X"]);
    expect(result.content).toBe(
      ["<<<<<<< mine (v5)", "a", "B", "c", "D", "=======", "X", ">>>>>>> theirs (v6)", "E"].join(
        "\n",
      ),
    );
  });

  it("lets a manual conflict be resolved by index on retry", () => {
    const first = resolveEditConflict(maintainerExample);
    expect(first.status).toBe("conflict");

    const second = resolveEditConflict({
      ...maintainerExample,
      resolutions: [{ index: 0, choice: "theirs" }],
    });
    expect(second.status).toBe("merged");
    expect(second.resolved).toBe(true);
    expect(second.content).toBe("X\nE");
  });
});

// ── resolution and retry ─────────────────────────────────────────────────────

describe("resolution and retry", () => {
  const input = {
    base: edit("a\nb\nc", 1),
    mine: edit("a\nMINE\nc", 2),
    theirs: edit("a\nTHEIRS\nc", 2),
  };

  it("resolves with prefer_mine", () => {
    const result = resolveEditConflict({ ...input, strategy: "prefer_mine" });
    expect(result.status).toBe("merged");
    expect(result.resolved).toBe(true);
    expect(result.content).toBe("a\nMINE\nc");
    expect(result.conflicts[0].resolvedWith).toBe("mine");
  });

  it("resolves with prefer_theirs", () => {
    const result = resolveEditConflict({ ...input, strategy: "prefer_theirs" });
    expect(result.status).toBe("merged");
    expect(result.content).toBe("a\nTHEIRS\nc");
    expect(result.conflicts[0].resolvedWith).toBe("theirs");
  });

  it("resolves one conflict at a time on retry", () => {
    const multi = {
      base: edit("1\n2\n3\n4\n5\n6\n7"),
      mine: edit("1\nM2\n3\n4\n5\nM6\n7"),
      theirs: edit("1\nT2\n3\n4\n5\nT6\n7"),
    };

    const firstPass = resolveEditConflict(multi);
    const partial = resolveEditConflict({
      ...multi,
      resolutions: [{ index: 1, choice: "theirs" }],
    });
    expect(partial.status).toBe("conflict");
    expect(partial.resolved).toBe(false);
    expect(partial.conflicts[0].resolvedWith).toBeNull();
    expect(partial.conflicts[1].resolvedWith).toBe("theirs");
    // Only the first conflict still has markers; the second is resolved.
    expect(partial.content.match(/<<<<<<< mine/g)).toHaveLength(1);
    expect(partial.content.match(/=======/g)).toHaveLength(1);
    expect(partial.content.endsWith("T6\n7")).toBe(true);

    const resolved = resolveEditConflict({
      ...multi,
      resolutions: [
        { index: 0, choice: "mine" },
        { index: 1, choice: "theirs" },
      ],
    });
    expect(resolved.status).toBe("merged");
    expect(resolved.content).toBe("1\nM2\n3\n4\n5\nT6\n7");
    expect(resolved.content).not.toContain("<<<<<<<");
    // Retrying the same request produces the same bytes.
    expect(
      resolveEditConflict({
        ...multi,
        resolutions: [
          { index: 0, choice: "mine" },
          { index: 1, choice: "theirs" },
        ],
      }).content,
    ).toBe(resolved.content);
    expect(firstPass.conflicts).toHaveLength(2);
  });

  it("rejects an out-of-range or malformed resolution", () => {
    expect(() =>
      resolveEditConflict({ ...input, resolutions: [{ index: 4, choice: "mine" }] }),
    ).toThrowError(EditConflictError);
    expect(() =>
      resolveEditConflict({ ...input, resolutions: [{ index: 0, choice: "other" as any }] }),
    ).toThrowError(EditConflictError);
  });
});

// ── failure modes ───────────────────────────────────────────────────────────

describe("validation failures", () => {
  it("rejects non-string or NUL-containing content", () => {
    expect(() =>
      resolveEditConflict({
        base: { content: 1 as any, version: 1 },
        mine: edit("a"),
        theirs: edit("a"),
      }),
    ).toThrowError(/must be a string/);
    expect(() =>
      resolveEditConflict({
        base: edit("a\u0000b"),
        mine: edit("a"),
        theirs: edit("a"),
      }),
    ).toThrowError(/NUL byte/);
  });

  it("rejects content above the byte and line limits", () => {
    expect(() =>
      resolveEditConflict({
        base: edit("x".repeat(MAX_EDIT_BYTES + 1)),
        mine: edit("a"),
        theirs: edit("a"),
      }),
    ).toThrowError(/exceeds/);
    expect(() =>
      resolveEditConflict({
        base: edit(Array.from({ length: MAX_EDIT_LINES + 1 }, () => "x").join("\n")),
        mine: edit("a"),
        theirs: edit("a"),
      }),
    ).toThrowError(/line merge limit/);
  });

  it("rejects stale or malformed versions", () => {
    expect(() =>
      resolveEditConflict({ base: edit("a", 2), mine: edit("a", 1), theirs: edit("a", 2) }),
    ).toThrowError(/mine.version/);
    expect(() =>
      resolveEditConflict({ base: edit("a", 1), mine: edit("a", 1.5), theirs: edit("a", 1) }),
    ).toThrowError(/integer/);
  });

  it("rejects an unknown strategy", () => {
    expect(() =>
      resolveEditConflict({
        base: edit("a"),
        mine: edit("b"),
        theirs: edit("c"),
        strategy: "merge" as any,
      }),
    ).toThrowError(/strategy/);
  });

  it("maps every error code to a remedy", () => {
    for (const code of [
      "invalid_content",
      "too_large",
      "too_many_lines",
      "invalid_version",
      "invalid_strategy",
      "invalid_resolution",
      "authorization_required",
      "not_edit_owner",
      "merged_output_too_large",
    ] as const) {
      expect(editConflictRemedy(code).length).toBeGreaterThan(10);
    }
  });
});

// ── authorization ────────────────────────────────────────────────────────────

describe("authorization", () => {
  it("accepts the owning wallet regardless of case", () => {
    expect(() =>
      assertCanResolveEdits("gabc", "GABC"),
    ).not.toThrow();
  });

  it("refuses a different wallet and a missing identity", () => {
    expect(() => assertCanResolveEdits("GAAA", "GBBB")).toThrowError(/only the wallet/i);
    expect(() => assertCanResolveEdits(undefined, "GBBB")).toThrowError(
      /authenticated wallet/i,
    );
    expect(() => assertCanResolveEdits("GAAA", undefined)).toThrowError(
      /owner wallet/i,
    );
  });

  it("enforces the session wallet in the controller", async () => {
    const noSession = mockRes();
    await ResolveEditConflict(
      { body: { ownerWallet: "GAAA", base: edit("a"), mine: edit("b"), theirs: edit("c") } } as any,
      noSession,
    );
    expect(noSession.statusCode).toBe(401);
    expect(noSession.body.code).toBe("authorization_required");

    const wrongOwner = mockRes();
    await ResolveEditConflict(
      {
        sessionWallet: "GAAA",
        body: { ownerWallet: "GBBB", base: edit("a"), mine: edit("b"), theirs: edit("c") },
      } as any,
      wrongOwner,
    );
    expect(wrongOwner.statusCode).toBe(403);
    expect(wrongOwner.body.code).toBe("not_edit_owner");
  });
});

// ── HTTP contract ────────────────────────────────────────────────────────────

describe("controller contract", () => {
  const body = {
    ownerWallet: "GABC",
    base: edit("a\nb\nc", 1),
    mine: edit("a\nMINE\nc", 2),
    theirs: edit("a\nTHEIRS\nc", 2),
  };

  it("returns 200 with conflict metadata and a retry hint", async () => {
    const res = mockRes();
    await ResolveEditConflict({ sessionWallet: "GABC", body } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("conflict");
    expect(res.body.next).toMatch(/resolutions/i);
  });

  it("returns 200 with merged content after a resolution retry", async () => {
    const res = mockRes();
    await ResolveEditConflict(
      {
        sessionWallet: "GABC",
        body: { ...body, resolutions: [{ index: 0, choice: "theirs" }] },
      } as any,
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("merged");
    expect(res.body.content).toBe("a\nTHEIRS\nc");
  });

  it("returns 400 for malformed content", async () => {
    const res = mockRes();
    await ResolveEditConflict(
      {
        sessionWallet: "GABC",
        body: { ...body, base: { content: 42, version: 1 } },
      } as any,
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("invalid_content");
  });

  it("returns 400 for an invalid version", async () => {
    const res = mockRes();
    await ResolveEditConflict(
      {
        sessionWallet: "GABC",
        body: { ...body, mine: edit("a", 0) },
      } as any,
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("invalid_version");
  });
});
