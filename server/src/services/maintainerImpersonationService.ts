import {
  ImpersonationSession,
  IImpersonationSession,
  ImpersonationScope,
} from "../models/ImpersonationSession";

export interface StartImpersonationParams {
  maintainerId: string;
  targetUserId: string;
  reason: string;
  supportTicketId?: string;
  scope?: ImpersonationScope;
  durationMinutes?: number;
}

export interface ImpersonationEvaluation {
  allowed: boolean;
  reason?: string;
  requiresElevation?: boolean;
}

export class MaintainerImpersonationService {
  /**
   * Starts a new scoped impersonation session.
   */
  static async startSession(
    params: StartImpersonationParams
  ): Promise<IImpersonationSession> {
    const duration = Math.min(Math.max(params.durationMinutes ?? 30, 5), 60);
    const expiresAt = new Date(Date.now() + duration * 60 * 1000);
    const sessionId = `imp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    return ImpersonationSession.create({
      sessionId,
      maintainerId: params.maintainerId,
      targetUserId: params.targetUserId,
      supportTicketId: params.supportTicketId,
      reason: params.reason,
      scope: params.scope ?? "READ_ONLY",
      isActive: true,
      expiresAt,
      auditTrail: [
        {
          action: "SESSION_STARTED",
          path: "/api/impersonation/start",
          method: "POST",
          status: "ALLOWED",
          timestamp: new Date(),
          details: { durationMinutes: duration, scope: params.scope },
        },
      ],
    });
  }

  /**
   * Evaluates whether an incoming HTTP request is permitted under impersonation.
   */
  static evaluateAccess(
    session: IImpersonationSession,
    method: string,
    path: string
  ): ImpersonationEvaluation {
    if (!session.isActive) {
      return { allowed: false, reason: "Impersonation session is terminated." };
    }

    if (new Date() > new Date(session.expiresAt)) {
      return { allowed: false, reason: "Impersonation session has expired." };
    }

    const upperMethod = method.toUpperCase();
    const isSafeRead = upperMethod === "GET" || upperMethod === "HEAD" || upperMethod === "OPTIONS";

    // Read-only scope: blocks all mutations
    if (session.scope === "READ_ONLY" && !isSafeRead) {
      return {
        allowed: false,
        reason: "Mutations are strictly prohibited under READ_ONLY impersonation scope.",
      };
    }

    // Dangerous financial/ownership mutations
    const dangerousPaths = ["/api/payments", "/api/wallet/transfer", "/api/prompts/delete", "/api/users/delete"];
    const isDangerous = dangerousPaths.some((p) => path.startsWith(p));

    if (isDangerous && !session.elevatedMutationConfirmed) {
      return {
        allowed: false,
        requiresElevation: true,
        reason: "Dangerous mutation requires explicit elevated maintainer confirmation.",
      };
    }

    return { allowed: true };
  }

  /**
   * Logs an action in the impersonation session's audit trail.
   */
  static async logAudit(
    sessionId: string,
    action: string,
    path: string,
    method: string,
    status: "ALLOWED" | "BLOCKED" | "ELEVATED_CONFIRMED",
    details?: Record<string, unknown>
  ): Promise<void> {
    await ImpersonationSession.updateOne(
      { sessionId },
      {
        $push: {
          auditTrail: {
            action,
            path,
            method,
            status,
            timestamp: new Date(),
            details,
          },
        },
      }
    );
  }

  /**
   * Ends an active impersonation session.
   */
  static async endSession(sessionId: string): Promise<IImpersonationSession | null> {
    const session = await ImpersonationSession.findOne({ sessionId });
    if (!session) return null;

    session.isActive = false;
    session.auditTrail.push({
      action: "SESSION_ENDED",
      path: "/api/impersonation/end",
      method: "POST",
      status: "ALLOWED",
      timestamp: new Date(),
    });

    await session.save();
    return session;
  }
}
