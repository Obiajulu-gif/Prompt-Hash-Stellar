import { Request, Response, NextFunction } from "express";
import {
  policyLimitService,
  ExpensiveOperation,
  POLICIES,
} from "../services/policyLimitService";

export interface PolicyLimitMiddlewareOptions {
  costOrSizeExtractor?: (req: Request) => number;
}

export function enforcePolicyLimit(
  operation: ExpensiveOperation,
  options?: PolicyLimitMiddlewareOptions
) {
  const policy = POLICIES[operation];

  return (req: Request, res: Response, next: NextFunction) => {
    const wallet =
      (req.headers["x-wallet-address"] as string) ||
      (req.body?.userAddress as string) ||
      (req.body?.address as string);
    const apiKey = (req.headers["x-api-key"] as string) || undefined;
    const ip = req.ip || req.socket.remoteAddress || "unknown";

    const costOrSize = options?.costOrSizeExtractor
      ? options.costOrSizeExtractor(req)
      : policy?.isSizeLimit
      ? Buffer.byteLength(JSON.stringify(req.body || {}), "utf8")
      : 1;

    const evaluation = policyLimitService.evaluate({
      operation,
      actor: { wallet, apiKey, ip },
      costOrSize,
    });

    res.setHeader("X-PolicyLimit-Limit", evaluation.limit);
    res.setHeader("X-PolicyLimit-Remaining", evaluation.remaining);
    res.setHeader("X-PolicyLimit-Reset", evaluation.resetAtSeconds);

    if (!evaluation.allowed) {
      if (evaluation.retryAfterSeconds > 0) {
        res.setHeader("Retry-After", evaluation.retryAfterSeconds);
      }

      const statusCode = policy?.isSizeLimit ? 413 : 429;

      return res.status(statusCode).json({
        error: "Policy limit exceeded for operation.",
        code: "POLICY_LIMIT_EXCEEDED",
        operation: evaluation.operation,
        category: evaluation.category,
        limit: evaluation.limit,
        currentUsage: evaluation.currentUsage,
        retryAfter: evaluation.retryAfterSeconds,
        resetAt: evaluation.resetAtSeconds,
        remediation: evaluation.remediation,
      });
    }

    next();
  };
}
