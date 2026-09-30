/**
 * Review List Endpoint
 *
 * Returns verified, durable reviews for a specific prompt in stable,
 * deterministic order.
 *
 * Pagination
 * ----------
 * Cursor-based pagination keyed on `createdAt` (ISO string) + `_id`
 * (tie-breaker) replaces the previous load-all approach.  Using a composite
 * cursor on (createdAt DESC, _id DESC) means that:
 *
 *   • New reviews inserted while a user is paginating appear *before* the
 *     current page position and are therefore never duplicated or skipped.
 *   • Hidden / deleted reviews are filtered at the query layer, so count
 *     and cursor arithmetic are based on the visible set only.
 *   • Filter behaviour is documented explicitly:
 *       - `hidden`  status → excluded from all paginated results.
 *       - `deleted` status → excluded.
 *       - `flagged` status → included (visible but marked); callers decide
 *         whether to render a warning badge.
 *
 * Request parameters
 * ------------------
 *   promptId    (required) — the prompt whose reviews to fetch.
 *   limit       (optional, default 20, max 50) — page size.
 *   cursor      (optional) — opaque cursor returned by a prior response.
 *                            Pass verbatim to fetch the next page.
 *   includeAll  (optional) — when "true", disables pagination and returns
 *                            every visible review (for stats recalculation
 *                            or export; should only be used server-side).
 *
 * Response shape
 * --------------
 * {
 *   reviews: ReviewApiShape[],
 *   stats: { total, averageRating, distribution },
 *   pagination: { hasNextPage, nextCursor }
 * }
 *
 * Schema versioning
 * -----------------
 * Each review is run through `transformReviewForApi` before being returned
 * so legacy records (schemaVersion absent or 0/1) are normalised to the
 * current shape.  A document with a future schemaVersion returns HTTP 422.
 */

import connectDb from "../../server/src/db/connectDb";
import Review from "../../server/src/models/Review";
import {
  transformReviewForApi,
  SchemaVersionError,
  CURRENT_REVIEW_SCHEMA_VERSION,
} from "../../server/src/services/schemaVersioning";

/** Maximum number of reviews returned per page. */
const MAX_PAGE_SIZE = 50;
/** Default page size when the caller omits `limit`. */
const DEFAULT_PAGE_SIZE = 20;

/**
 * Parse and validate the opaque cursor produced by this endpoint.
 * Returns null if the cursor is absent or malformed (treat as first page).
 */
function parseCursor(
  raw: string | undefined,
): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string"
    ) {
      return { createdAt: new Date(parsed.createdAt), id: parsed.id };
    }
  } catch {
    // malformed — ignore
  }
  return null;
}

/** Encode a cursor from the last document in a page. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id }),
    "utf8",
  ).toString("base64url");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { promptId, cursor: rawCursor, includeAll } = req.query || {};
  const limitParam = req.query?.limit;
  const limit = Math.min(
    parseInt(String(limitParam), 10) || DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  );

  if (!promptId) {
    res.status(400).json({ error: "promptId query parameter is required" });
    return;
  }

  try {
    await connectDb();

    // Build the base filter — always exclude hidden and deleted reviews.
    const baseFilter: Record<string, unknown> = {
      promptId: String(promptId),
      status: { $nin: ["hidden", "deleted"] },
    };

    // ---------------------------------------------------------------------------
    // Pagination: apply cursor as a compound (createdAt, _id) boundary.
    // We sort DESC so "earlier than cursor" means older records.
    // ---------------------------------------------------------------------------
    const cursor = parseCursor(rawCursor as string | undefined);
    if (cursor && includeAll !== "true") {
      baseFilter.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
      ];
    }

    const fetchLimit = includeAll === "true" ? 0 : limit + 1;

    const reviews = await Review.find(baseFilter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(fetchLimit)
      .lean();

    // Determine pagination metadata.
    let hasNextPage = false;
    let nextCursor: string | null = null;

    if (includeAll !== "true" && reviews.length > limit) {
      hasNextPage = true;
      reviews.pop(); // remove the sentinel document
      const last = reviews[reviews.length - 1] as any;
      nextCursor = encodeCursor(
        last.createdAt instanceof Date ? last.createdAt : new Date(last.createdAt),
        String(last._id),
      );
    }

    // ---------------------------------------------------------------------------
    // Apply schema compatibility transforms + compute rating stats.
    // ---------------------------------------------------------------------------
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    const formattedReviews: ReturnType<typeof transformReviewForApi>[] = [];

    for (const raw of reviews) {
      let review;
      try {
        review = transformReviewForApi(raw as unknown as Record<string, unknown>);
      } catch (e) {
        if (e instanceof SchemaVersionError) {
          res.status(422).json({
            error: e.message,
            supportedSchemaVersion: CURRENT_REVIEW_SCHEMA_VERSION,
          });
          return;
        }
        throw e;
      }
      distribution[review.rating] = (distribution[review.rating] || 0) + 1;
      sum += review.rating;
      formattedReviews.push(review);
    }

    // Stats are always computed from the current page to avoid a separate
    // full-collection count on every paginated request.  Callers that need
    // global stats should pass `includeAll=true` (server-to-server only).
    const total = formattedReviews.length;
    const averageRating = total > 0 ? sum / total : 0;

    res.status(200).json({
      reviews: formattedReviews,
      stats: {
        total,
        averageRating: Math.round(averageRating * 10) / 10,
        distribution,
      },
      pagination: {
        hasNextPage,
        nextCursor,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch reviews";
    console.error("Review fetch error:", message);
    res.status(500).json({ error: message });
  }
}
