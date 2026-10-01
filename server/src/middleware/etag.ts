import { createHash } from "crypto";
import { Request, Response } from "express";

interface ConditionalJsonOptions {
  /** Seconds a shared/public cache may serve this response before revalidating. Default 30. */
  maxAgeSeconds?: number;
}

/**
 * Computes a strong, content-derived ETag for a JSON-serializable payload,
 * honors `If-None-Match` with a 304 when unchanged, and otherwise sends the
 * payload with `ETag` + `Cache-Control: public` headers set.
 *
 * The tag is a hash of the payload itself, so it changes automatically
 * whenever the underlying data changes (e.g. after an indexed listing
 * update) without needing separate invalidation bookkeeping — see
 * docs/operations/indexing-and-search.md.
 */
export function sendConditionalJson(
  req: Request,
  res: Response,
  payload: unknown,
  options: ConditionalJsonOptions = {},
): Response {
  const maxAge = options.maxAgeSeconds ?? 30;
  const etag = `"${createHash("sha1").update(JSON.stringify(payload)).digest("hex")}"`;

  res.setHeader("Cache-Control", `public, max-age=${maxAge}, must-revalidate`);
  res.setHeader("ETag", etag);

  if (requestMatchesETag(req, etag)) {
    return res.status(304).end();
  }

  return res.status(200).json(payload);
}

function requestMatchesETag(req: Request, etag: string): boolean {
  const ifNoneMatch = req.headers["if-none-match"];
  if (!ifNoneMatch) return false;

  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === etag || tag === "*");
}

/** Marks a wallet-scoped response as private so shared/public caches never store it. */
export function markPrivate(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
}
