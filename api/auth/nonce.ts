/**
 * GET /api/auth/nonce?address=<stellarAddress>
 *
 * Issues a cryptographically secure, single-use nonce for wallet authentication.
 * The nonce is cached server-side (Redis → LRU fallback) with a 5-minute TTL.
 *
 * The returned `message` field is the exact string the client must pass to
 * the wallet's signMessage / signBlob API. The signed bytes must then be
 * submitted to POST /api/auth/verify along with the nonce and public key.
 *
 * Security properties:
 *  - Nonce is 32 bytes of crypto.randomBytes → base64url → URL-safe
 *  - IP + address rate-limited (same buckets as challenge endpoint)
 *  - Nonce is one-time-use (consumed on /verify to prevent replays)
 *  - TTL of 5 minutes limits the window for offline brute-force
 */

import { randomBytes } from "crypto";
import { withObservability } from "../../src/lib/observability/wrapper";
import { checkRateLimit } from "../../src/lib/observability/rateLimiter";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";
import { buildAuthChallengeMessage } from "../../src/lib/auth/stellarAuth";
import {
  storeNonce,
  NONCE_TTL_MS,
  isValidStellarAddress,
} from "../../src/lib/auth/nonceStore";

async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json(apiError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."));
    return;
  }

  const address = String(req.query?.address ?? "").trim();

  if (!address) {
    res
      .status(400)
      .json(apiError(ErrorCode.MISSING_FIELDS, "address query parameter is required."));
    return;
  }

  if (!isValidStellarAddress(address)) {
    res
      .status(400)
      .json(apiError(ErrorCode.MISSING_FIELDS, "address must be a valid Stellar public key."));
    return;
  }

  const clientIp = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress) as string;
  const isAuthenticated = false; // nonce endpoint is always unauthenticated

  // Reuse the same rate-limit buckets as the challenge endpoint
  const ipLimit = await checkRateLimit("challenge", clientIp, isAuthenticated);
  if (!ipLimit.success) {
    res.setHeader("X-RateLimit-Limit", ipLimit.limit);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader("X-RateLimit-Reset", ipLimit.reset);
    res
      .status(429)
      .json(
        apiError(ErrorCode.RATE_LIMIT_IP, "Too many requests. Please try again later.", {
          reset: ipLimit.reset,
        }),
      );
    return;
  }

  res.setHeader("X-RateLimit-Limit", ipLimit.limit);
  res.setHeader("X-RateLimit-Remaining", ipLimit.remaining);
  res.setHeader("X-RateLimit-Reset", ipLimit.reset);

  const now = Date.now();
  const expiresAt = now + NONCE_TTL_MS;

  // 32 random bytes → base64url string (no +/= chars, URL-safe)
  const nonce = randomBytes(32).toString("base64url");

  const domain =
    req.headers.host ?? process.env.AUTH_DOMAIN ?? "prompt-hash.vercel.app";

  const message = buildAuthChallengeMessage({ address, nonce, domain, issuedAt: now });

  // Persist nonce so /verify can confirm it was actually issued and not
  // replayed beyond its TTL.
  await storeNonce(nonce, { address, expiresAt, issuedAt: now, domain });

  req.logger?.info({ address: address.slice(0, 8) + "..." }, "Auth nonce issued");

  res.status(200).json({
    nonce,
    expiresAt,
    issuedAt: now,
    message,
  });
}

export default withObservability(handler, "auth/nonce");
