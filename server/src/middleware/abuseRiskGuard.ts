/**
 * Express guard that scores a high-impact operation before its handler runs.
 *
 *   allow    → next()
 *   step_up  → 403 STEP_UP_REQUIRED unless the request carries a freshly
 *              signed wallet session for the acting wallet
 *   review   → 202 REVIEW_REQUIRED with a review id; the operation is held
 *              until an admin approves it (one-shot approval)
 *   block    → 403 OPERATION_BLOCKED
 *
 * Mode comes from ABUSE_RISK_MODE (`off` | `shadow` | `enforce`, default
 * `shadow`). In `shadow` every decision is logged but nothing is enforced;
 * flipping to `off` is the instant rollback. See docs/abuse-risk-detection.md.
 */

import { NextFunction, Request, Response } from "express";
import {
  abuseActivityLedger,
  EvaluationOutcome,
  evaluateOperation,
  HighImpactOperation,
  OperationContext,
  parseRiskMode,
  RiskMode,
} from "../services/abuseRiskScoring";
import { hasFreshWalletSession } from "./walletSession";
import { logger } from "../services/structuredLogger";
import { recordAuditEvent } from "../services/auditTrail";

export interface AbuseRiskGuardOptions {
  operation: HighImpactOperation;
  /** Extract the context fields from the request; wallet is required. */
  extract: (req: Request) => Omit<OperationContext, "operation" | "now"> | null;
  /** Override mode resolution (tests). Defaults to ABUSE_RISK_MODE. */
  mode?: () => RiskMode;
  /** Override step-up proof (tests). Defaults to a fresh wallet session. */
  stepUpSatisfied?: (req: Request, wallet: string) => boolean;
}

export interface RiskAnnotatedRequest extends Request {
  riskOutcome?: EvaluationOutcome;
}

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || undefined;
}

export function abuseRiskGuard(options: AbuseRiskGuardOptions) {
  return function abuseRiskMiddleware(
    req: RiskAnnotatedRequest,
    res: Response,
    next: NextFunction,
  ): void {
    const mode = options.mode ? options.mode() : parseRiskMode(process.env.ABUSE_RISK_MODE);
    if (mode === "off") {
      next();
      return;
    }

    const fields = options.extract(req);
    // Without an identifiable wallet there is nothing to score; the route's
    // own validation will reject malformed requests.
    if (!fields || !fields.wallet) {
      next();
      return;
    }

    const ctx: OperationContext = {
      ...fields,
      operation: options.operation,
      ip: fields.ip ?? clientIp(req),
      now: Date.now(),
    };

    const outcome = evaluateOperation(ctx, mode);
    req.riskOutcome = outcome;
    const { assessment } = outcome;

    if (assessment.decision !== "allow") {
      // Wallet is deliberately omitted; the redactor also masks it.
      logger.info("abuse risk decision", {
        action: "abuseRisk",
        operation: ctx.operation,
        mode,
        decision: assessment.decision,
        enforced: outcome.action,
        score: assessment.score,
        signals: assessment.signals.map((s) => s.code),
        reviewId: outcome.reviewId,
      });
      void recordAuditEvent({
        action: "abuse_risk_decision",
        result: outcome.action === "allow" ? "success" : "blocked",
        promptId: ctx.target ?? null,
        walletAddress: ctx.wallet,
        requestId: (req as { requestId?: string }).requestId ?? null,
        reason: `op=${ctx.operation} mode=${mode} decision=${assessment.decision} enforced=${outcome.action} score=${assessment.score} signals=${assessment.signals.map((s) => s.code).join("|")}`,
      });
    }

    const finish = (ok: boolean) => abuseActivityLedger.record(ctx, ok);
    res.once("finish", () => finish(res.statusCode < 400));

    const stepUpOk = options.stepUpSatisfied
      ? options.stepUpSatisfied(req, ctx.wallet)
      : hasFreshWalletSession(req, ctx.wallet);

    switch (outcome.action) {
      case "allow":
        next();
        return;
      case "step_up":
        if (stepUpOk) {
          next();
          return;
        }
        res.status(403).json({
          error: "Additional verification required for this operation.",
          code: "STEP_UP_REQUIRED",
          riskScore: assessment.score,
          reasons: assessment.signals.map((s) => ({ code: s.code, explanation: s.explanation })),
          remedy: "Sign a fresh wallet-session challenge (GET /api/wallet-session/challenge) and retry.",
        });
        return;
      case "review":
        res.status(202).json({
          error: "This operation is held for review.",
          code: "REVIEW_REQUIRED",
          reviewId: outcome.reviewId,
          riskScore: assessment.score,
          reasons: assessment.signals.map((s) => ({ code: s.code, explanation: s.explanation })),
        });
        return;
      case "block":
        res.status(403).json({
          error: "This operation was blocked by abuse protection.",
          code: "OPERATION_BLOCKED",
          reviewId: outcome.reviewId,
          reasons: assessment.signals.map((s) => ({ code: s.code, explanation: s.explanation })),
        });
        return;
    }
  };
}
