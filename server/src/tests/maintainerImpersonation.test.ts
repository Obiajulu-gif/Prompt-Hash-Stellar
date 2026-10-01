import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MaintainerImpersonationService } from "../services/maintainerImpersonationService";
import { ImpersonationSession } from "../models/ImpersonationSession";

describe("MaintainerImpersonationService (Issue #834)", () => {
  beforeEach(async () => {
    await ImpersonationSession.deleteMany({});
  });

  afterEach(async () => {
    await ImpersonationSession.deleteMany({});
  });

  it("starts a time-limited scoped impersonation session with audit logging", async () => {
    const session = await MaintainerImpersonationService.startSession({
      maintainerId: "maint_alice",
      targetUserId: "user_bob",
      reason: "Debug issue #123 buyer cannot unlock purchased prompt",
      supportTicketId: "TICK-8841",
      scope: "READ_ONLY",
      durationMinutes: 30,
    });

    expect(session.sessionId).toMatch(/^imp_/);
    expect(session.maintainerId).toBe("maint_alice");
    expect(session.targetUserId).toBe("user_bob");
    expect(session.scope).toBe("READ_ONLY");
    expect(session.isActive).toBe(true);
    expect(session.auditTrail).toHaveLength(1);
    expect(session.auditTrail[0].action).toBe("SESSION_STARTED");
  });

  it("allows safe GET/read requests under READ_ONLY scope", async () => {
    const session = await MaintainerImpersonationService.startSession({
      maintainerId: "maint_alice",
      targetUserId: "user_bob",
      reason: "Inspect user dashboard view",
      scope: "READ_ONLY",
    });

    const evalResult = MaintainerImpersonationService.evaluateAccess(session, "GET", "/api/prompts/purchased");
    expect(evalResult.allowed).toBe(true);
  });

  it("blocks mutations under READ_ONLY scope", async () => {
    const session = await MaintainerImpersonationService.startSession({
      maintainerId: "maint_alice",
      targetUserId: "user_bob",
      reason: "Inspect user profile",
      scope: "READ_ONLY",
    });

    const evalResult = MaintainerImpersonationService.evaluateAccess(session, "POST", "/api/prompts/publish");
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.reason).toContain("READ_ONLY");
  });

  it("blocks dangerous financial operations without elevated confirmation", async () => {
    const session = await MaintainerImpersonationService.startSession({
      maintainerId: "maint_alice",
      targetUserId: "user_bob",
      reason: "Testing workflow",
      scope: "REPRODUCE_ISSUE",
    });

    const evalResult = MaintainerImpersonationService.evaluateAccess(session, "POST", "/api/payments/checkout");
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.requiresElevation).toBe(true);
  });

  it("terminates impersonation session and records audit event", async () => {
    const session = await MaintainerImpersonationService.startSession({
      maintainerId: "maint_alice",
      targetUserId: "user_bob",
      reason: "Short inspection",
    });

    const ended = await MaintainerImpersonationService.endSession(session.sessionId);
    expect(ended?.isActive).toBe(false);
    expect(ended?.auditTrail.some((a) => a.action === "SESSION_ENDED")).toBe(true);

    const postEndEval = MaintainerImpersonationService.evaluateAccess(ended!, "GET", "/api/prompts");
    expect(postEndEval.allowed).toBe(false);
  });
});
