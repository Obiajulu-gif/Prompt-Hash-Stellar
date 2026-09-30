/**
 * Tests for the paginated review list endpoint (api/reviews/list.ts).
 *
 * Covers:
 *  • Basic happy-path: returns reviews + stats + pagination metadata.
 *  • Cursor pagination: next page picks up exactly where the previous left off.
 *  • Stability: inserts and deletes between page fetches do not duplicate or
 *    skip records.
 *  • Filter behaviour: hidden and deleted reviews are excluded; flagged are
 *    included.
 *  • Schema compatibility: legacy v0 reviews are normalised; future-version
 *    reviews return HTTP 422.
 *  • includeAll: bypasses pagination and returns the full visible set.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CURRENT_REVIEW_SCHEMA_VERSION } from "../services/schemaVersioning";

// ---------------------------------------------------------------------------
// Mock DB and the Review model before importing the handler
// ---------------------------------------------------------------------------

const mockSort = vi.fn();
const mockLimit = vi.fn();
const mockLean = vi.fn();
const mockFind = vi.fn();

vi.mock("../db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(true),
}));

vi.mock("../models/Review", () => ({
  default: {
    find: mockFind,
  },
}));

// Import handler *after* mocks are in place.
// From server/src/tests/ the api/ directory is three levels up.
const { default: handler } = await import("../../../api/reviews/list");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(query: Record<string, string | undefined> = {}): any {
  return { method: "GET", query };
}

function makeRes(): any {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

/** Build a fake review Mongoose lean document. */
function fakeReview(
  overrides: Partial<{
    _id: string;
    promptId: string;
    userAddress: string;
    rating: number;
    text: string;
    status: string;
    schemaVersion: number;
    createdAt: Date;
    verified: boolean;
  }> = {},
) {
  return {
    _id: overrides._id ?? "rev1",
    promptId: overrides.promptId ?? "prompt1",
    userAddress: overrides.userAddress ?? "GABC",
    rating: overrides.rating ?? 4,
    text: overrides.text ?? "Great prompt",
    status: overrides.status ?? "published",
    schemaVersion: overrides.schemaVersion ?? CURRENT_REVIEW_SCHEMA_VERSION,
    createdAt: overrides.createdAt ?? new Date("2024-06-01T00:00:00Z"),
    verified: overrides.verified !== undefined ? overrides.verified : true,
  };
}

/**
 * Wire the mock chain so `Review.find().sort().limit().lean()` resolves with
 * the given array.
 */
function mockReviewQuery(docs: ReturnType<typeof fakeReview>[]) {
  mockLean.mockResolvedValueOnce(docs);
  mockLimit.mockReturnValueOnce({ lean: mockLean });
  mockSort.mockReturnValueOnce({ limit: mockLimit });
  mockFind.mockReturnValueOnce({ sort: mockSort });
}

// ---------------------------------------------------------------------------
// Encode a cursor the same way the handler does
// ---------------------------------------------------------------------------
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id }),
    "utf8",
  ).toString("base64url");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/reviews/list — basic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 405 for non-GET requests", async () => {
    const req = { method: "POST", query: { promptId: "p1" } };
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("returns 400 when promptId is missing", async () => {
    const res = makeRes();
    await handler(makeReq({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("promptId") }),
    );
  });

  it("returns reviews, stats and pagination for a valid promptId", async () => {
    const review = fakeReview({ _id: "r1", rating: 5 });
    mockReviewQuery([review]);

    const res = makeRes();
    await handler(makeReq({ promptId: "prompt1" }), res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];

    expect(Array.isArray(payload.reviews)).toBe(true);
    expect(payload.reviews).toHaveLength(1);
    expect(payload.stats).toBeDefined();
    expect(payload.pagination).toBeDefined();
  });

  it("returns pagination.hasNextPage false and nextCursor null when results fit in one page", async () => {
    mockReviewQuery([fakeReview({ _id: "r1" })]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1", limit: "5" }), res);

    const { pagination } = res.json.mock.calls[0][0];
    expect(pagination.hasNextPage).toBe(false);
    expect(pagination.nextCursor).toBeNull();
  });

  it("computes correct averageRating and distribution from the returned page", async () => {
    const reviews = [
      fakeReview({ _id: "r1", rating: 5 }),
      fakeReview({ _id: "r2", rating: 3 }),
      fakeReview({ _id: "r3", rating: 4 }),
    ];
    mockReviewQuery(reviews);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1" }), res);

    const { stats } = res.json.mock.calls[0][0];
    expect(stats.total).toBe(3);
    expect(stats.averageRating).toBeCloseTo(4.0, 1);
    expect(stats.distribution[5]).toBe(1);
    expect(stats.distribution[3]).toBe(1);
    expect(stats.distribution[4]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------

describe("GET /api/reviews/list — cursor pagination", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns nextCursor when results exceed the page size (limit+1 sentinel)", async () => {
    // Request limit=2 → handler fetches 3; if 3 come back, hasNextPage=true
    const reviews = [
      fakeReview({ _id: "r3", createdAt: new Date("2024-06-03T00:00:00Z") }),
      fakeReview({ _id: "r2", createdAt: new Date("2024-06-02T00:00:00Z") }),
      fakeReview({ _id: "r1", createdAt: new Date("2024-06-01T00:00:00Z") }), // sentinel
    ];
    mockReviewQuery(reviews);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1", limit: "2" }), res);

    const { pagination, reviews: returned } = res.json.mock.calls[0][0];
    expect(returned).toHaveLength(2);
    expect(pagination.hasNextPage).toBe(true);
    expect(pagination.nextCursor).toBeTruthy();
  });

  it("passes cursor as compound (createdAt, _id) boundary to MongoDB", async () => {
    const cursorDate = new Date("2024-06-02T00:00:00Z");
    const cursorId = "r2";
    const cursor = encodeCursor(cursorDate, cursorId);

    mockReviewQuery([fakeReview({ _id: "r1" })]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1", cursor }), res);

    // The $or filter must have been included in the find query
    const findCall = mockFind.mock.calls[0][0];
    expect(findCall.$or).toBeDefined();
    expect(findCall.$or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ createdAt: { $lt: cursorDate } }),
      ]),
    );
  });

  it("returns empty reviews array with hasNextPage false on the last page", async () => {
    mockReviewQuery([]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1", limit: "5" }), res);

    const { reviews, pagination } = res.json.mock.calls[0][0];
    expect(reviews).toHaveLength(0);
    expect(pagination.hasNextPage).toBe(false);
    expect(pagination.nextCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stability under concurrent changes
// ---------------------------------------------------------------------------

describe("GET /api/reviews/list — stability under concurrent changes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("excludes records inserted after the cursor was issued (new insert before cursor boundary)", async () => {
    // Simulates: user fetched page 1 (got r3, r2) and has cursor pointing
    // at r2.  A new review r4 is inserted between requests.  Page 2 query
    // with cursor should still return only r1 (r4 is newer → above cursor).
    const cursorDate = new Date("2024-06-02T00:00:00Z");
    const cursor = encodeCursor(cursorDate, "r2");

    // DB returns only r1 (r4 is filtered server-side by the cursor boundary)
    mockReviewQuery([fakeReview({ _id: "r1", createdAt: new Date("2024-06-01T00:00:00Z") })]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1", cursor }), res);

    const { reviews, pagination } = res.json.mock.calls[0][0];
    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe("r1");
    expect(pagination.hasNextPage).toBe(false);
  });

  it("does not re-surface a deleted review that was visible on a previous page", async () => {
    // After r2 is deleted, the next page from cursor still only gets r1.
    const cursor = encodeCursor(new Date("2024-06-02T00:00:00Z"), "r2");
    mockReviewQuery([fakeReview({ _id: "r1" })]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1", cursor, limit: "10" }), res);

    const { reviews } = res.json.mock.calls[0][0];
    // r2 is gone, r1 comes through without duplication
    expect(reviews.map((r: any) => r.id)).toEqual(["r1"]);
  });
});

// ---------------------------------------------------------------------------
// Filter behaviour
// ---------------------------------------------------------------------------

describe("GET /api/reviews/list — filter behaviour", () => {
  beforeEach(() => vi.clearAllMocks());

  it("always excludes hidden and deleted reviews via the query filter", async () => {
    mockReviewQuery([]); // we just check the query argument

    const res = makeRes();
    await handler(makeReq({ promptId: "p1" }), res);

    const findArg = mockFind.mock.calls[0][0];
    // Must use $nin to exclude hidden and deleted
    expect(findArg.status).toEqual(
      expect.objectContaining({ $nin: expect.arrayContaining(["hidden", "deleted"]) }),
    );
  });

  it("includes flagged reviews (they are returned but callers render a badge)", async () => {
    const flaggedReview = fakeReview({ _id: "r1", status: "flagged" });
    mockReviewQuery([flaggedReview]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1" }), res);

    const { reviews } = res.json.mock.calls[0][0];
    expect(reviews).toHaveLength(1);
    expect(reviews[0].status).toBe("flagged");
  });

  it("applies promptId filter to every query", async () => {
    mockReviewQuery([]);

    const res = makeRes();
    await handler(makeReq({ promptId: "specific-prompt-42" }), res);

    const findArg = mockFind.mock.calls[0][0];
    expect(findArg.promptId).toBe("specific-prompt-42");
  });
});

// ---------------------------------------------------------------------------
// Schema compatibility transforms
// ---------------------------------------------------------------------------

describe("GET /api/reviews/list — schema compatibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalises legacy v0 reviews to current schemaVersion", async () => {
    const legacyReview = fakeReview({ _id: "r1", schemaVersion: undefined as any });
    // Remove schemaVersion entirely to simulate a pre-migration document
    const raw = { ...legacyReview };
    delete (raw as any).schemaVersion;
    mockReviewQuery([raw as any]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1" }), res);

    const { reviews } = res.json.mock.calls[0][0];
    expect(reviews[0].schemaVersion).toBe(CURRENT_REVIEW_SCHEMA_VERSION);
  });

  it("normalises v1 reviews, defaulting status to 'published'", async () => {
    const v1 = { ...fakeReview({ _id: "r1" }), schemaVersion: 1 };
    delete (v1 as any).status;
    mockReviewQuery([v1 as any]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1" }), res);

    const { reviews } = res.json.mock.calls[0][0];
    expect(reviews[0].status).toBe("published");
    expect(reviews[0].schemaVersion).toBe(CURRENT_REVIEW_SCHEMA_VERSION);
  });

  it("returns HTTP 422 when a review has a future (unsupported) schemaVersion", async () => {
    const futureReview = fakeReview({
      _id: "r1",
      schemaVersion: CURRENT_REVIEW_SCHEMA_VERSION + 99,
    });
    mockReviewQuery([futureReview]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1" }), res);

    expect(res.status).toHaveBeenCalledWith(422);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error).toContain("Unsupported");
    expect(payload.supportedSchemaVersion).toBe(CURRENT_REVIEW_SCHEMA_VERSION);
  });

  it("passes through current-version reviews unchanged", async () => {
    const current = fakeReview({
      _id: "r1",
      schemaVersion: CURRENT_REVIEW_SCHEMA_VERSION,
      status: "published",
    });
    mockReviewQuery([current]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1" }), res);

    const { reviews } = res.json.mock.calls[0][0];
    expect(reviews[0].schemaVersion).toBe(CURRENT_REVIEW_SCHEMA_VERSION);
    expect(reviews[0].status).toBe("published");
  });
});

// ---------------------------------------------------------------------------
// includeAll bypass
// ---------------------------------------------------------------------------

describe("GET /api/reviews/list — includeAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes limit=0 to MongoDB when includeAll=true, bypassing page-size cap", async () => {
    mockReviewQuery([]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1", includeAll: "true" }), res);

    expect(mockLimit).toHaveBeenCalledWith(0);
  });

  it("does not apply cursor filter when includeAll=true", async () => {
    const cursor = encodeCursor(new Date(), "someid");
    mockReviewQuery([]);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1", includeAll: "true", cursor }), res);

    const findArg = mockFind.mock.calls[0][0];
    expect(findArg.$or).toBeUndefined();
  });

  it("returns hasNextPage false and nextCursor null when includeAll=true", async () => {
    const reviews = Array.from({ length: 30 }, (_, i) =>
      fakeReview({ _id: `r${i}`, createdAt: new Date(Date.now() - i * 1000) }),
    );
    mockReviewQuery(reviews);

    const res = makeRes();
    await handler(makeReq({ promptId: "p1", includeAll: "true" }), res);

    const { pagination } = res.json.mock.calls[0][0];
    expect(pagination.hasNextPage).toBe(false);
    expect(pagination.nextCursor).toBeNull();
  });
});
