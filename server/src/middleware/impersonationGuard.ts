import { Request, Response, NextFunction } from "express";
import { MaintainerImpersonationService } from "../services/maintainerImpersonationService";
import { ImpersonationSession } from "../models/ImpersonationSession";

export interface ImpersonatedRequest extends Request {
  impersonationSession?: {
    sessionId: string;
    maintainerId: string;
    targetUserId: string;
    scope: string;
  };
}

export async function impersonationGuard(
  req: ImpersonatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const impersonationHeader = req.headers["x-impersonation-session-id"];
  if (!impersonationHeader) {
    return next();
  }

  const sessionId = Array.isArray(impersonationHeader) ? impersonationHeader[0] : impersonationHeader;
  const session = await ImpersonationSession.findOne({ sessionId, isActive: true });

  if (!session) {
    res.status(401).json({ error: "Invalid or inactive impersonation session" });
    return;
  }

  const evaluation = MaintainerImpersonationService.evaluateAccess(session, req.method, req.path);

  if (!evaluation.allowed) {
    await MaintainerImpersonationService.logAudit(
      sessionId,
      "MUTATION_BLOCKED",
      req.path,
      req.method,
      "BLOCKED",
      { reason: evaluation.reason, requiresElevation: evaluation.requiresElevation }
    );

    res.status(403).json({
      error: "Action blocked by Impersonation Safety Guard",
      reason: evaluation.reason,
      requiresElevation: evaluation.requiresElevation,
    });
    return;
  }

  await MaintainerImpersonationService.logAudit(
    sessionId,
    "API_REQUEST_EXECUTED",
    req.path,
    req.method,
    "ALLOWED"
  );

  req.impersonationSession = {
    sessionId: session.sessionId,
    maintainerId: session.maintainerId,
    targetUserId: session.targetUserId,
    scope: session.scope,
  };

  res.setHeader("X-Impersonation-Active", "true");
  res.setHeader("X-Impersonated-User", session.targetUserId);

  next();
}
