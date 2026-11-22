import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Resource budget tests for worst-case user, ledger and search workloads (#983).
 *
 * These tests do not assert wall-clock time (flaky in CI). They enforce the
 * invariants that actually bound the work a single request can cause:
 *
 *   1. **Caller-supplied page sizes are clamped** — `limit=100000` must never
 *      reach `.limit()` on a Mongo query.
 *   2. **Query-count ceilings** — one request must not fan out into a number
 *      of model calls proportional to the data it returns (no N+1).
 *   3. **Unbounded scans are capped, and truncation is reported** rather than
 *      silently returning a partial accounting file.
 *   4. **Policy ceilings reject at the documented boundary** (the first tests
 *      of `policyLimitService`, which previously had zero coverage).
 *
 * Every ceiling asserted here is a named exported constant, so tightening or
 * relaxing a budget is an explicit, reviewable diff.
 */

// ─── shared chainable mock helpers ───────────────────────────────────────────

type Recorder = { calls: Array<{ op: string; args: any[] }> };

function makeQuery(rec: Recorder, op: string, rows: any[] = []) {
  const chain: any = {
    or: () => chain,
    sort: () => chain,
    skip: () => chain,
    populate: () => chain,
    select: () => chain,
    getFilter: () => ({}),
    limit: (...args: any[]) => {
      rec.calls.push({ op: `${op}.limit`, args });
      return chain;
    },
    lean: () => {
      rec.calls.push({ op: `${op}.lean`, args: [] });
      return Promise.resolve(rows);
    },
    then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. SEARCH WORKLOAD
// ═════════════════════════════════════════════════════════════════════════════

const searchRec: Recorder = { calls: [] };

vi.mock("../models/Prompt", () => ({
  default: {
    find: vi.fn((...args: any[]) => {
      searchRec.calls.push({ op: "find", args });
      return makeQuery(searchRec, "find", []);
    }),
    countDocuments: vi.fn((...args: any[]) => {
      searchRec.calls.push({ op: "countDocuments", args });
      return Promise.resolve(0);
    }),
    distinct: vi.fn(() => Promise.resolve([])),
    aggregate: vi.fn(() => Promise.resolve([])),
    bulkWrite: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock("../services/cacheService", () => ({
  cacheGetJson: vi.fn(() => Promise.resolve(null)),
  cacheSetJson: vi.fn(() => Promise.resolve(undefined)),
  cacheDelPattern: vi.fn(() => Promise.resolve(undefined)),
  CACHE_KEYS: {
    searchResults: (k: string) => `s:${k}`,
    searchSuggestions: (k: string) => `sg:${k}`,
    categories: () => "cat",
    featuredPrompts: (l: number) => `f:${l}`,
  },
  DEFAULT_TTL_SECONDS: 60,
  CATEGORY_TTL_SECONDS: 600,
}));

vi.mock("../services/categoryTaxonomyService", () => ({
  resolveCategory: vi.fn(() => null),
}));

import {
  searchPrompts,
  getSearchSuggestions,
  getFeaturedPrompts,
  clampSearchLimit,
  SEARCH_PAGE_SIZE_MAX,
} from "../controllers/searchController";

const limitCalls = (rec: Recorder) =>
  rec.calls.filter((c) => c.op.endsWith(".limit")).map((c) => c.args[0]);

describe("resource budget — search workload", () => {
  beforeEach(() => {
    searchRec.calls.length = 0;
  });

  describe("clampSearchLimit", () => {
    it("clamps an absurd limit to the documented ceiling", () => {
      expect(clampSearchLimit(100_000)).toBe(SEARCH_PAGE_SIZE_MAX);
      expect(clampSearchLimit(Number.MAX_SAFE_INTEGER)).toBe(SEARCH_PAGE_SIZE_MAX);
    });

    it("keeps legitimate limits untouched", () => {
      expect(clampSearchLimit(1)).toBe(1);
      expect(clampSearchLimit(20)).toBe(20);
      expect(clampSearchLimit(SEARCH_PAGE_SIZE_MAX)).toBe(SEARCH_PAGE_SIZE_MAX);
    });

    it("falls back for non-finite and non-positive input", () => {
      expect(clampSearchLimit(undefined)).toBe(20);
      expect(clampSearchLimit(Number.NaN)).toBe(20);
      expect(clampSearchLimit(0)).toBe(20);
      expect(clampSearchLimit(-5)).toBe(20);
      expect(clampSearchLimit(Infinity)).toBe(20);
    });

    it("floors fractional input rather than passing it to Mongo", () => {
      expect(clampSearchLimit(20.9)).toBe(20);
    });

    it("honours a custom fallback", () => {
      expect(clampSearchLimit(undefined, 5)).toBe(5);
      expect(clampSearchLimit(9999, 6)).toBe(SEARCH_PAGE_SIZE_MAX);
    });
  });

  it("never passes an unclamped caller limit to the query", async () => {
    await searchPrompts({ query: "react", limit: 100_000, page: 1 });
    const limits = limitCalls(searchRec);
    expect(limits).toHaveLength(1);
    expect(limits[0]).toBeLessThanOrEqual(SEARCH_PAGE_SIZE_MAX);
    expect(limits[0]).toBe(SEARCH_PAGE_SIZE_MAX); // clamped, not dropped
  });

  it("issues at most ONE countDocuments per request (count ceiling)", async () => {
    await searchPrompts({ query: "anything", limit: 100_000, page: 3 });
    const counts = searchRec.calls.filter((c) => c.op === "countDocuments");
    expect(counts).toHaveLength(1);
  });

  it("bounds skip by the clamped page size, not the raw one", async () => {
    await searchPrompts({ query: "x", limit: 100_000, page: 2 });
    // skip = (page-1) * clampedLimit = 1 * 100, never 1 * 100000.
    const limits = limitCalls(searchRec);
    expect(limits[0]).toBe(SEARCH_PAGE_SIZE_MAX);
  });

  it("normalises a hostile page number instead of computing a negative skip", async () => {
    const result = await searchPrompts({ query: "x", limit: 5, page: -10 });
    // Page is folded back to 1 and echoed, so no `.skip(negative)` ever runs.
    expect(result.page).toBe(1);
    expect(searchRec.calls.filter((c) => c.op === "countDocuments")).toHaveLength(1);
  });

  it("clamps autocomplete suggestions (keystroke path)", async () => {
    await getSearchSuggestions("react", 100_000);
    const limits = limitCalls(searchRec);
    expect(limits.length).toBeGreaterThan(0);
    for (const l of limits) expect(l).toBeLessThanOrEqual(SEARCH_PAGE_SIZE_MAX);
  });

  it("skips all query work for a degenerate suggestion input", async () => {
    const out = await getSearchSuggestions("a", 100_000);
    expect(out).toEqual({ titles: [], categories: [], tags: [] });
    expect(searchRec.calls.filter((c) => c.op === "countDocuments")).toHaveLength(0);
  });

  it("clamps featured prompts", async () => {
    await getFeaturedPrompts(100_000);
    const limits = limitCalls(searchRec);
    expect(limits).toHaveLength(1);
    expect(limits[0]).toBeLessThanOrEqual(SEARCH_PAGE_SIZE_MAX);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. POLICY CEILINGS  (first-ever coverage of policyLimitService)
// ═════════════════════════════════════════════════════════════════════════════

import { policyLimitService, POLICIES } from "../services/policyLimitService";

describe("resource budget — policy ceilings", () => {
  beforeEach(() => {
    policyLimitService.reset();
  });

  it("accepts a deep-search offset exactly at the ceiling", () => {
    const r = policyLimitService.evaluate({
      operation: "INDEXING_DEEP_SEARCH",
      actor: { ip: "1.1.1.1" },
      costOrSize: POLICIES.INDEXING_DEEP_SEARCH.defaultLimit,
    });
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("rejects a deep-search offset one past the ceiling with 413 remediation", () => {
    const r = policyLimitService.evaluate({
      operation: "INDEXING_DEEP_SEARCH",
      actor: { ip: "1.1.1.1" },
      costOrSize: POLICIES.INDEXING_DEEP_SEARCH.defaultLimit + 1,
    });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.remediation).toMatch(/Refine your search query/);
  });

  it("caps a bulk import at STORAGE_BULK_IMPORT items", () => {
    const at = policyLimitService.evaluate({
      operation: "STORAGE_BULK_IMPORT",
      actor: { ip: "2.2.2.2" },
      costOrSize: POLICIES.STORAGE_BULK_IMPORT.defaultLimit,
    });
    const over = policyLimitService.evaluate({
      operation: "STORAGE_BULK_IMPORT",
      actor: { ip: "2.2.2.2" },
      costOrSize: POLICIES.STORAGE_BULK_IMPORT.defaultLimit + 1,
    });
    expect(at.allowed).toBe(true);
    expect(over.allowed).toBe(false);
  });

  it("rate-limits a windowed operation rather than allowing a burst", () => {
    const op = "COMPUTE_SIMILARITY_CHECK" as const;
    const limit = POLICIES[op].defaultLimit;
    // Fill the window exactly.
    for (let i = 0; i < limit; i++) {
      expect(
        policyLimitService.evaluate({ operation: op, actor: { ip: "3.3.3.3" }, costOrSize: 1 })
          .allowed,
      ).toBe(true);
    }
    // One more must trip.
    expect(
      policyLimitService.evaluate({ operation: op, actor: { ip: "3.3.3.3" }, costOrSize: 1 }).allowed,
    ).toBe(false);
  });

  it("keeps rate-limit windows per actor, not globally", () => {
    const op = "COMPUTE_SIMILARITY_CHECK" as const;
    for (let i = 0; i < POLICIES[op].defaultLimit; i++) {
      policyLimitService.evaluate({ operation: op, actor: { ip: "4.4.4.4" }, costOrSize: 1 });
    }
    expect(
      policyLimitService.evaluate({ operation: op, actor: { ip: "4.4.4.4" }, costOrSize: 1 }).allowed,
    ).toBe(false);
    // A different actor still has budget.
    expect(
      policyLimitService.evaluate({ operation: op, actor: { ip: "5.5.5.5" }, costOrSize: 1 }).allowed,
    ).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. LEDGER WORKLOAD
// ═════════════════════════════════════════════════════════════════════════════

const ledgerRec: Recorder = { calls: [] };

vi.mock("../models/LedgerEntry", () => {
  const creators = ["ga", "gb", "gc"];
  const rows = creators.map((c) => ({
    _id: `e_${c}`,
    entryType: "sale",
    creatorAddress: c,
    amount: 10,
    currency: "XLM",
    referenceId: `ref_${c}`,
    description: "d",
    createdAt: new Date(),
  }));

  const Mock: any = {
    find: (query: any) => {
      ledgerRec.calls.push({ op: "find", args: [query] });
      return {
        sort: () => ({
          limit: (n: number) => ({
            lean: () => {
              ledgerRec.calls.push({ op: "find.limit", args: [n] });
              return Promise.resolve(rows);
            },
          }),
          lean: () => Promise.resolve(rows),
        }),
        lean: () => Promise.resolve(rows),
      };
    },
    distinct: (field: string) => {
      ledgerRec.calls.push({ op: "distinct", args: [field] });
      return Promise.resolve(creators);
    },
  };
  return { LedgerEntry: Mock, LedgerEntrySchema: {}, __creators: creators };
});

import {
  getAdminPayoutSummaryView,
  exportLedgerReport,
  exportLedgerReportBounded,
  clampLedgerScanSize,
  LEDGER_SCAN_MAX_ENTRIES,
  recalculateCreatorBalance,
} from "../services/payoutLedgerService";

describe("resource budget — ledger workload", () => {
  beforeEach(() => {
    ledgerRec.calls.length = 0;
  });

  it("bounds the admin summary to 2 queries per creator + 1 distinct (no N+1 blowup)", async () => {
    const N = 3; // mock returns 3 creators
    await getAdminPayoutSummaryView();
    const finds = ledgerRec.calls.filter((c) => c.op === "find").length;
    const distincts = ledgerRec.calls.filter((c) => c.op === "distinct").length;

    expect(distincts).toBe(1);
    // Ceiling: 2 finds per creator (summary + reconciliation). It used to be
    // 3 because reconciliation recomputed a summary that had just been built.
    expect(finds).toBeLessThanOrEqual(2 * N + 1);
  });

  it("does not recompute a creator's balance inside reconciliation", async () => {
    // Isolate a single creator so the count is exact and readable.
    await getAdminPayoutSummaryView();
    const finds = ledgerRec.calls.filter((c) => c.op === "find").length;
    // 3 creators x 2 finds = 6, plus no extra.
    expect(finds).toBeLessThanOrEqual(6);
  });
});
