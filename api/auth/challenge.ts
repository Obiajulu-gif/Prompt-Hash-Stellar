import { createChallengeToken } from "../../src/lib/auth/challenge";
import { withObservability } from "../../src/lib/observability/wrapper";
import { checkRateLimit } from "../../src/lib/observability/rateLimiter";
import { metrics } from "../../src/lib/observability/metrics";

async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const clientIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress) as string;
  const rateLimit = checkRateLimit("challenge", clientIp);

  if (!rateLimit.success) {
    req.logger.warn({ clientIp }, "Rate limit exceeded for challenge issuance");
    metrics.trackRateLimitHit("challenge", clientIp);
    res.status(429).json({
      error: "Too many requests. Please try again later.",
      reset: rateLimit.reset,
    });
    return;
  }

  const secret = process.env.CHALLENGE_TOKEN_SECRET;
  if (!secret) {
    req.logger.error("CHALLENGE_TOKEN_SECRET is not configured.");
    res.status(500).json({ error: "Configuration error." });
    return;
  }

  const { address, promptId } = req.body ?? {};
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
