import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createChallengeToken } from "../../src/lib/auth/challenge";
import { withObservability } from "../../src/lib/observability/wrapper";
import { checkRateLimit } from "../../src/lib/observability/rateLimiter";
import { metrics } from "../../src/lib/observability/metrics";
import { recordAuditEvent } from "../../server/src/services/auditTrail";
import { apiError, ErrorCode, type ApiErrorResponse } from "../../src/lib/api/errorCodes";
import { isPlaceholder } from "../../src/lib/validation/envValidator";

/* eslint-disable no-unused-vars */
export interface ChallengeRequest {
  address: string;
  promptId: string;
}

export interface ChallengeResponse {
  token: string;
  challenge: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}
/* eslint-enable no-unused-vars */

// Fail-fast module-load validation: reject startup if secrets are missing.
(function validateEnv(): void {
  const secret = process.env.CHALLENGE_TOKEN_SECRET;
  if (!secret || isPlaceholder(secret) || secret.length < 16) {
    console.error("FATAL: CHALLENGE_TOKEN_SECRET is missing, placeholder, or too short (< 16 chars).");
    if (process.env.NODE_ENV === "production") {
      throw new Error("CHALLENGE_TOKEN_SECRET not configured.");
    }
  }
})();

async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json(apiError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."));
    return;
  }

  const clientIp = String(
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
  );
  const { address, promptId }: Partial<ChallengeRequest> = req.body ?? {};

  const isAuthenticated = Boolean(address);

  const rateLimit = await checkRateLimit("challenge", clientIp, isAuthenticated);

  if (!rateLimit.success) {
    req.logger.warn({ clientIp }, "Rate limit exceeded for challenge issuance");
    metrics.trackRateLimitHit("challenge", clientIp);
    void recordAuditEvent({
      action: "challenge_rate_limited",
      result: "blocked",
      promptId: address && promptId ? String(promptId) : null,
      walletAddress: address ? String(address) : null,
      requestId: req.requestId ?? null,
      clientIp,
      reason: "rate_limit_exceeded",
    });
    res.setHeader("X-RateLimit-Limit", rateLimit.limit);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader("X-RateLimit-Reset", rateLimit.reset);
    res.status(429).json(
      apiError(ErrorCode.RATE_LIMIT_IP, "Too many requests. Please try again later.", {
        reset: rateLimit.reset,
      }),
    );
    return;
  }

  res.setHeader("X-RateLimit-Limit", rateLimit.limit);
  res.setHeader("X-RateLimit-Remaining", rateLimit.remaining);
  res.setHeader("X-RateLimit-Reset", rateLimit.reset);

  const secret = process.env.CHALLENGE_TOKEN_SECRET;
  if (!secret || isPlaceholder(secret) || secret.length < 16) {
    req.logger.error("CHALLENGE_TOKEN_SECRET is not configured correctly.");
    res.status(500).json(apiError(ErrorCode.CONFIGURATION_ERROR, "Configuration error."));
    return;
  }

  if (!address || !promptId) {
    res.status(400).json(
      apiError(ErrorCode.MISSING_FIELDS, "address and promptId are required."),
    );
    return;
  }

  // Issue a strictly time-bound challenge (default TTL = 5 minutes).
  // The ttlMs parameter is capped at 10 minutes server-side to prevent
  // unreasonably long-lived tokens.
  const MAX_TTL_MS = 10 * 60 * 1000;
  const ttlMs = Math.min(5 * 60 * 1000, MAX_TTL_MS);
  const challenge = createChallengeToken(secret, String(address), String(promptId), Date.now(), ttlMs);

  const response: ChallengeResponse = {
    token: challenge.token,
    challenge: challenge.challenge,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    nonce: challenge.nonce,
  };

  metrics.trackChallengeIssued(String(address), String(promptId));
  req.logger.info({ address, promptId }, "Challenge token issued successfully");

  void recordAuditEvent({
    action: "challenge_issued",
    result: "success",
    promptId: String(promptId),
    walletAddress: String(address),
    requestId: req.requestId ?? null,
    clientIp,
    reason: null,
  });

  res.status(200).json(response);
}

export default withObservability(handler, "auth/challenge");
