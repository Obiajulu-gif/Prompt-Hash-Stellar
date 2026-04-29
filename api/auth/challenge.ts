import { createChallengeToken } from "../../src/lib/auth/challenge";
import { withObservability } from "../../src/lib/observability/wrapper";
import { checkRateLimit } from "../../src/lib/observability/rateLimiter";
import { metrics } from "../../src/lib/observability/metrics";
import { getSecret } from "../../src/lib/auth/secretManager";

async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const clientIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress) as string;
  const { address, promptId } = req.body ?? {};

  // Authenticated if wallet address is provided in the request body.
  const isAuthenticated = Boolean(address);

  const rateLimit = await checkRateLimit("challenge", clientIp, isAuthenticated);

  if (!rateLimit.success) {
    req.logger.warn({ clientIp }, "Rate limit exceeded for challenge issuance");
    metrics.trackRateLimitHit("challenge", clientIp);
    res.setHeader("X-RateLimit-Limit", rateLimit.limit);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader("X-RateLimit-Reset", rateLimit.reset);
    res.status(429).json({
      error: "Too many requests. Please try again later.",
      reset: rateLimit.reset,
    });
    return;
  }

  res.setHeader("X-RateLimit-Limit", rateLimit.limit);
  res.setHeader("X-RateLimit-Remaining", rateLimit.remaining);
  res.setHeader("X-RateLimit-Reset", rateLimit.reset);

  const secret = process.env.CHALLENGE_TOKEN_SECRET;
  if (!secret) {
    req.logger.error("CHALLENGE_TOKEN_SECRET is not configured or accessible.");
    res.status(500).json({ error: "Configuration error." });
    return;
  }

  if (!address || !promptId) {
    res.status(400).json({ error: "address and promptId are required." });
    return;
  }

  const challenge = createChallengeToken(secret, String(address), String(promptId));

  metrics.trackChallengeIssued(String(address), String(promptId));
  req.logger.info({ address, promptId }, "Challenge token issued successfully");

  res.status(200).json(challenge);
}

export default withObservability(handler, "auth/challenge");
