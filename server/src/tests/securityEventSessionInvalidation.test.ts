import { beforeEach, describe, expect, it } from "vitest";
import {
  SECURITY_EVENT_POLICY,
  SessionRevocationError,
  SessionRevocationRegistry,
  globalSessionRevocationRegistry,
  invalidateSessionsForSecurityEvent,
  normalizeSubject,
  MAX_REVOCATION_RETENTION_MS,
  type RevocationActor,
  type SecurityEventType,
} from "../services/sessionRevocationService";
import {
  InvalidateSessions,
  ReinstateSubject,
  GetRevocationStatus,
  GetSecurityAuditTrail,
} from "../controllers/securityEventControllers";
import type { AdminRequest } from "../middleware/adminAuth";
import type { Response } from "express";

/**
 * Comprehensive security-event session invalidation tests.
 *
 * Covers every acceptance criterion from the issue:
 *   1. Normal path — events invalidate the right sessions
 *   2. Failure path — invalid inputs, bad subjects, missing fields
 *   3. Retry / idempotency — duplicate events, concurrent cutoffs
 *   4. Authorization — only actors with admin/security:revoke can act
 *   5. Edge cases — TTL pruning, boundary timestamps, nonce lifecycle
 *   6. Recovery / rollback — reinstatement after false alarms
 */

const ADMIN: RevocationActor = {
  id: "ops-sec-lead",
  role: "admin",
  permissions: new Set(["admin", "security:revoke"]),
};

const SECURITY_ONLY: RevocationActor = {
  id: "ops-security-analyst",
  role: "security",
  permissions: new Set(["security:revoke"]),
};

const VIEWER: RevocationActor = {
  id: "guest-user",
  role: "viewer",
  permissions: new Set(["prompts:read"]),
};

// Valid base32 Stellar addresses (A-Z, 2-7 only)
const WALLET_A = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GNOEDVLQC5WWXBXRXG2V";
const WALLET_B = "GCZXN7PIRZGNMHGA7Q5R374WXZW6W5Y45PNM26QCOHOHOGIPLDTZQK7U";
const OPERATOR = "ops-alice";

const T0 = 1_000_000;
const EVENT_AT = T0 + 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// 1. NORMAL PATH
// ─────────────────────────────────────────────────────────────────────────────

describe("normal path: security events invalidate sessions correctly", () => {
  let registry: SessionRevocationRegistry;

  beforeEach(() => {
    registry = new SessionRevocationRegistry();
  });

  const SUBJECT_EVENTS: SecurityEventType[] = [
    "wallet_compromise",
    "admin_key_rotation",
    "permission_revocation",
    "suspicious_activity",
    "explicit_logout_all",
    "credential_change",
    "role_change",
    "account_recovery",
  ];

  it.each(SUBJECT_EVENTS)(
    "%s cuts off the subject's earlier sessions and returns a user-safe message",
    (type) => {
      invalidateSessionsForSecurityEvent(
        registry,
        { type, subject: WALLET_A, reason: "test-normal", actor: ADMIN },
        EVENT_AT,
      );

      const stale = registry.isRevoked(WALLET_A, T0);
      expect(stale.revoked).toBe(true);
      expect(stale.code).toBe("subject_revoked_by_security_event");
      expect(stale.message).toBe(SECURITY_EVENT_POLICY[type].userMessage);
      // Internal reason must not appear in the user-facing message
      expect(stale.message).not.toContain("test-normal");
    },
  );

  it("admits sessions issued after the event", () => {
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "credential_change", subject: WALLET_A, reason: "pw change", actor: ADMIN },
      EVENT_AT,
    );
    expect(registry.isRevoked(WALLET_A, EVENT_AT + 1).revoked).toBe(false);
  });

  it("isolates subject events — other wallets are unaffected", () => {
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "role_change", subject: WALLET_A, reason: "downgrade", actor: ADMIN },
      EVENT_AT,
    );
    expect(registry.isRevoked(WALLET_B, T0).revoked).toBe(false);
  });

  it("global_emergency_cutoff ends every session platform-wide", () => {
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "global_emergency_cutoff", subject: "*", reason: "root rotation", actor: ADMIN },
      EVENT_AT,
    );

    expect(registry.isRevoked(WALLET_A, T0).revoked).toBe(true);
    expect(registry.isRevoked(WALLET_B, T0).revoked).toBe(true);
    expect(registry.isRevoked(OPERATOR, T0).revoked).toBe(true);
    // After the cutoff, new sessions are fine
    expect(registry.isRevoked(WALLET_A, EVENT_AT + 1).revoked).toBe(false);
  });

  it("revokes a specific nonce while leaving other tokens for the same subject valid", () => {
    registry.recordSecurityEvent(
      {
        type: "suspicious_activity",
        targetSubject: WALLET_A,
        targetNonce: "leaked-nonce",
        reason: "nonce leaked",
        actor: ADMIN,
      },
      EVENT_AT,
    );

    const issuedAfter = EVENT_AT + 500;
    expect(
      registry.isRevoked(WALLET_A, issuedAfter, "leaked-nonce", EVENT_AT + 1000).revoked,
    ).toBe(true);
    expect(
      registry.isRevoked(WALLET_A, issuedAfter, "safe-nonce", EVENT_AT + 1000).revoked,
    ).toBe(false);
  });

  it("records every event in the audit trail", () => {
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "credential_change", subject: WALLET_A, reason: "r1", actor: ADMIN },
      EVENT_AT,
    );
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "role_change", subject: WALLET_B, reason: "r2", actor: ADMIN },
      EVENT_AT + 1000,
    );

    const trail = registry.getAuditTrail();
    expect(trail).toHaveLength(2);
    expect(trail[0].type).toBe("credential_change");
    expect(trail[1].type).toBe("role_change");
  });

  it("stores metadata for forensic inspection", () => {
    const event = invalidateSessionsForSecurityEvent(
      registry,
      {
        type: "wallet_compromise",
        subject: WALLET_A,
        reason: "phishing",
        actor: ADMIN,
        metadata: { ticket: "SEC-9999", reporter: "soc-team" },
      },
      EVENT_AT,
    );

    const trail = registry.getAuditTrail();
    expect(trail[0].metadata).toEqual({ ticket: "SEC-9999", reporter: "soc-team" });
    expect(event.eventId).toMatch(/^sec_evt_/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. FAILURE PATH
// ─────────────────────────────────────────────────────────────────────────────

describe("failure path: invalid inputs are rejected cleanly", () => {
  let registry: SessionRevocationRegistry;

  beforeEach(() => {
    registry = new SessionRevocationRegistry();
  });

  it("rejects a global event targeting a single subject", () => {
    expect(() =>
      invalidateSessionsForSecurityEvent(
        registry,
        { type: "global_emergency_cutoff", subject: WALLET_A, reason: "leak", actor: ADMIN },
        EVENT_AT,
      ),
    ).toThrow(SessionRevocationError);
  });

  it("rejects a subject event targeting '*'", () => {
    expect(() =>
      invalidateSessionsForSecurityEvent(
        registry,
        { type: "credential_change", subject: "*", reason: "pw", actor: ADMIN },
        EVENT_AT,
      ),
    ).toThrow(SessionRevocationError);
  });

  it("rejects an empty subject", () => {
    expect(() =>
      registry.recordSecurityEvent({
        type: "wallet_compromise",
        targetSubject: "   ",
        reason: "test",
        actor: ADMIN,
      }),
    ).toThrow(SessionRevocationError);
  });

  it("rejects a revokedBefore far in the future (>60s)", () => {
    const farFuture = Date.now() + 120_000;
    expect(() =>
      registry.recordSecurityEvent(
        {
          type: "wallet_compromise",
          targetSubject: WALLET_A,
          reason: "test",
          revokedBefore: farFuture,
          actor: ADMIN,
        },
        Date.now(),
      ),
    ).toThrow(SessionRevocationError);
  });

  it("throws with correct error codes for each failure type", () => {
    try {
      invalidateSessionsForSecurityEvent(
        registry,
        { type: "global_emergency_cutoff", subject: WALLET_A, reason: "x", actor: ADMIN },
        EVENT_AT,
      );
    } catch (err) {
      expect(err).toBeInstanceOf(SessionRevocationError);
      expect((err as SessionRevocationError).code).toBe("invalid_subject");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. RETRY / IDEMPOTENCY PATH
// ─────────────────────────────────────────────────────────────────────────────

describe("retry / idempotency: duplicate events do not corrupt state", () => {
  let registry: SessionRevocationRegistry;

  beforeEach(() => {
    registry = new SessionRevocationRegistry();
  });

  it("advances the cutoff when a later event extends the window", () => {
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "credential_change", subject: WALLET_A, reason: "first", actor: ADMIN },
      T0,
    );
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "credential_change", subject: WALLET_A, reason: "second", actor: ADMIN },
      T0 + 5_000,
    );

    // Session at T0 + 2000 should be revoked by the extended cutoff
    expect(registry.isRevoked(WALLET_A, T0 + 2_000).revoked).toBe(true);
    // Session after the second cutoff is fine
    expect(registry.isRevoked(WALLET_A, T0 + 6_000).revoked).toBe(false);
  });

  it("never lowers the cutoff (max wins)", () => {
    registry.recordSecurityEvent(
      {
        type: "wallet_compromise",
        targetSubject: WALLET_A,
        reason: "event-1",
        revokedBefore: T0 + 10_000,
        actor: ADMIN,
      },
      T0 + 10_000,
    );
    // Earlier cutoff should not reduce the existing one
    registry.recordSecurityEvent(
      {
        type: "suspicious_activity",
        targetSubject: WALLET_A,
        reason: "event-2",
        revokedBefore: T0 + 5_000,
        actor: ADMIN,
      },
      T0 + 11_000,
    );

    // Still revoked up to T0 + 10_000 (the max)
    expect(registry.isRevoked(WALLET_A, T0 + 9_000).revoked).toBe(true);
  });

  it("retains both events in the audit trail even when the cutoff does not advance", () => {
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "credential_change", subject: WALLET_A, reason: "first", actor: ADMIN },
      T0,
    );
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "credential_change", subject: WALLET_A, reason: "second", actor: ADMIN },
      T0 + 5_000,
    );

    expect(registry.getAuditTrail()).toHaveLength(2);
  });

  it("handles global cutoff idempotently — later cutoff wins", () => {
    registry.recordSecurityEvent(
      {
        type: "global_emergency_cutoff",
        targetSubject: "*",
        reason: "rotation-1",
        revokedBefore: T0,
        actor: ADMIN,
      },
      T0,
    );
    registry.recordSecurityEvent(
      {
        type: "global_emergency_cutoff",
        targetSubject: "*",
        reason: "rotation-2",
        revokedBefore: T0 + 5_000,
        actor: ADMIN,
      },
      T0 + 5_000,
    );

    expect(registry.isRevoked(WALLET_A, T0 + 3_000).revoked).toBe(true);
    expect(registry.isRevoked(WALLET_A, T0 + 6_000).revoked).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. AUTHORIZATION PATH
// ─────────────────────────────────────────────────────────────────────────────

describe("authorization: only privileged actors can record events", () => {
  let registry: SessionRevocationRegistry;

  beforeEach(() => {
    registry = new SessionRevocationRegistry();
  });

  it("rejects an unauthorized actor from recording a security event", () => {
    expect(() =>
      invalidateSessionsForSecurityEvent(
        registry,
        { type: "wallet_compromise", subject: WALLET_A, reason: "test", actor: VIEWER },
        EVENT_AT,
      ),
    ).toThrow(SessionRevocationError);

    try {
      invalidateSessionsForSecurityEvent(
        registry,
        { type: "wallet_compromise", subject: WALLET_A, reason: "test", actor: VIEWER },
        EVENT_AT,
      );
    } catch (err) {
      expect((err as SessionRevocationError).code).toBe("unauthorized");
    }
  });

  it("allows an actor with only security:revoke (no admin)", () => {
    expect(() =>
      invalidateSessionsForSecurityEvent(
        registry,
        { type: "credential_change", subject: WALLET_A, reason: "ok", actor: SECURITY_ONLY },
        EVENT_AT,
      ),
    ).not.toThrow();

    expect(registry.isRevoked(WALLET_A, T0).revoked).toBe(true);
  });

  it("rejects an unauthorized actor from reinstating a subject", () => {
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "credential_change", subject: WALLET_A, reason: "ok", actor: ADMIN },
      EVENT_AT,
    );

    expect(() =>
      registry.reinstateSubject(WALLET_A, VIEWER, "false alarm"),
    ).toThrow(SessionRevocationError);
  });

  it("allows reinstatement by security:revoke actor", () => {
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "credential_change", subject: WALLET_A, reason: "ok", actor: ADMIN },
      EVENT_AT,
    );

    expect(registry.reinstateSubject(WALLET_A, SECURITY_ONLY, "false alarm")).toBe(true);
    expect(registry.isRevoked(WALLET_A, T0).revoked).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. EDGE CASES — TTL pruning, boundary timestamps, normalizeSubject
// ─────────────────────────────────────────────────────────────────────────────

describe("edge cases: TTL pruning, boundary timestamps, subject normalization", () => {
  let registry: SessionRevocationRegistry;

  beforeEach(() => {
    registry = new SessionRevocationRegistry();
  });

  it("prunes subject cutoffs older than the retention window", () => {
    const oldTime = 1_000;
    registry.recordSecurityEvent(
      {
        type: "wallet_compromise",
        targetSubject: WALLET_A,
        reason: "old event",
        revokedBefore: oldTime,
        actor: ADMIN,
      },
      oldTime,
    );

    // Verify it's active immediately
    expect(registry.isRevoked(WALLET_A, oldTime - 1, undefined, oldTime + 100).revoked).toBe(true);

    // Prune at a time beyond the retention window
    const afterRetention = oldTime + MAX_REVOCATION_RETENTION_MS + 1;
    registry.pruneExpiredEntries(afterRetention);

    // The cutoff should have been pruned
    expect(registry.isRevoked(WALLET_A, oldTime - 1, undefined, afterRetention).revoked).toBe(false);
  });

  it("prunes expired nonce entries", () => {
    registry.recordSecurityEvent(
      {
        type: "suspicious_activity",
        targetSubject: WALLET_A,
        targetNonce: "old-nonce",
        reason: "nonce revoked",
        revokedBefore: T0 - 1000, // cutoff in the past
        actor: ADMIN,
      },
      T0,
    );

    // Nonce is active
    expect(registry.isRevoked(WALLET_A, T0 + 100, "old-nonce", T0 + 200).revoked).toBe(true);

    // After retention
    const afterRetention = T0 + MAX_REVOCATION_RETENTION_MS + 1;
    registry.pruneExpiredEntries(afterRetention);
    expect(registry.isRevoked(WALLET_A, T0 + 100, "old-nonce", afterRetention).revoked).toBe(false);
  });

  it("handles boundary: issuedAt exactly equal to revokedBefore is revoked", () => {
    registry.recordSecurityEvent(
      {
        type: "credential_change",
        targetSubject: WALLET_A,
        reason: "pw change",
        revokedBefore: T0,
        actor: ADMIN,
      },
      T0,
    );

    // issuedAt == revokedBefore → revoked (<=)
    expect(registry.isRevoked(WALLET_A, T0).revoked).toBe(true);
    // issuedAt == revokedBefore + 1 → not revoked
    expect(registry.isRevoked(WALLET_A, T0 + 1).revoked).toBe(false);
  });

  it("normalizes lowercase Stellar addresses to uppercase", () => {
    const lower = "ga2c5rfpe6gckmy3us5pab6uzlkigahwkxx2gnoedvlqc5wwxbxrxg2v";
    expect(normalizeSubject(lower)).toBe(WALLET_A);
  });

  it("normalizes admin handles to trimmed lowercase", () => {
    expect(normalizeSubject("  OPS-ALICE  ")).toBe("ops-alice");
  });

  it("normalizes global wildcard", () => {
    expect(normalizeSubject("*")).toBe("*");
  });

  it("matches case-insensitive wallet lookups across record and query", () => {
    registry.recordSecurityEvent(
      {
        type: "wallet_compromise",
        targetSubject: WALLET_A.toLowerCase(),
        reason: "test",
        revokedBefore: T0,
        actor: ADMIN,
      },
      T0,
    );

    // Query with uppercase version should still find the revocation
    expect(registry.isRevoked(WALLET_A, T0 - 100).revoked).toBe(true);
  });

  it("non-revoked status returns no code, reason, or message", () => {
    const status = registry.isRevoked(WALLET_A, T0);
    expect(status.revoked).toBe(false);
    expect(status.code).toBeUndefined();
    expect(status.reason).toBeUndefined();
    expect(status.message).toBeUndefined();
  });

  it("global cutoff takes precedence over a more permissive subject cutoff", () => {
    // Subject cutoff at T0 + 1000
    registry.recordSecurityEvent(
      {
        type: "credential_change",
        targetSubject: WALLET_A,
        reason: "subject",
        revokedBefore: T0 + 1_000,
        actor: ADMIN,
      },
      T0 + 1_000,
    );
    // Global cutoff at T0 + 5000
    registry.recordSecurityEvent(
      {
        type: "global_emergency_cutoff",
        targetSubject: "*",
        reason: "global",
        revokedBefore: T0 + 5_000,
        actor: ADMIN,
      },
      T0 + 5_000,
    );

    // Between the two cutoffs: subject cutoff would miss it, but global catches it
    const status = registry.isRevoked(WALLET_A, T0 + 3_000);
    expect(status.revoked).toBe(true);
    expect(status.code).toBe("global_security_event");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. RECOVERY / ROLLBACK
// ─────────────────────────────────────────────────────────────────────────────

describe("recovery / rollback: reinstatement after false alarms", () => {
  let registry: SessionRevocationRegistry;

  beforeEach(() => {
    registry = new SessionRevocationRegistry();
  });

  it("reinstates a subject and immediately restores access", () => {
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "suspicious_activity", subject: WALLET_A, reason: "alert", actor: ADMIN },
      EVENT_AT,
    );
    expect(registry.isRevoked(WALLET_A, T0).revoked).toBe(true);

    registry.reinstateSubject(WALLET_A, ADMIN, "verified false positive");
    expect(registry.isRevoked(WALLET_A, T0).revoked).toBe(false);
  });

  it("reinstating a non-existent subject returns false", () => {
    const result = registry.reinstateSubject(WALLET_B, ADMIN, "nothing to reinstate");
    expect(result).toBe(false);
  });

  it("reinstating the global wildcard clears the global cutoff", () => {
    registry.recordSecurityEvent(
      {
        type: "global_emergency_cutoff",
        targetSubject: "*",
        reason: "rotation",
        revokedBefore: T0,
        actor: ADMIN,
      },
      T0,
    );

    expect(registry.isRevoked(WALLET_A, T0 - 100).revoked).toBe(true);

    registry.reinstateSubject("*", ADMIN, "false alarm");
    expect(registry.isRevoked(WALLET_A, T0 - 100).revoked).toBe(false);
  });

  it("reinstatement does not remove audit trail entries", () => {
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "credential_change", subject: WALLET_A, reason: "pw change", actor: ADMIN },
      EVENT_AT,
    );
    registry.reinstateSubject(WALLET_A, ADMIN, "false alarm");

    // The original event is still in the audit trail
    expect(registry.getAuditTrail()).toHaveLength(1);
    expect(registry.getAuditTrail()[0].type).toBe("credential_change");
  });

  it("re-recording a security event after reinstatement works normally", () => {
    // First revocation
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "credential_change", subject: WALLET_A, reason: "first", actor: ADMIN },
      EVENT_AT,
    );
    expect(registry.isRevoked(WALLET_A, T0).revoked).toBe(true);

    // Reinstate
    registry.reinstateSubject(WALLET_A, ADMIN, "false alarm");
    expect(registry.isRevoked(WALLET_A, T0).revoked).toBe(false);

    // Second revocation
    invalidateSessionsForSecurityEvent(
      registry,
      { type: "wallet_compromise", subject: WALLET_A, reason: "real this time", actor: ADMIN },
      EVENT_AT + 20_000,
    );
    expect(registry.isRevoked(WALLET_A, T0).revoked).toBe(true);
    expect(registry.getAuditTrail()).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. POLICY COMPLETENESS
// ─────────────────────────────────────────────────────────────────────────────

describe("policy completeness: SECURITY_EVENT_POLICY is well-formed", () => {
  it("has an entry for every SecurityEventType", () => {
    const allTypes: SecurityEventType[] = [
      "wallet_compromise",
      "admin_key_rotation",
      "permission_revocation",
      "suspicious_activity",
      "explicit_logout_all",
      "global_emergency_cutoff",
      "credential_change",
      "role_change",
      "account_recovery",
    ];

    for (const type of allTypes) {
      expect(SECURITY_EVENT_POLICY).toHaveProperty(type);
      expect(SECURITY_EVENT_POLICY[type].scope).toMatch(/^(subject|global)$/);
      expect(SECURITY_EVENT_POLICY[type].userMessage.length).toBeGreaterThan(0);
    }
  });

  it("user messages never contain internal keywords", () => {
    for (const [, policy] of Object.entries(SECURITY_EVENT_POLICY)) {
      expect(policy.userMessage).not.toMatch(/reason|secret|key leak|internal|phishing/i);
    }
  });

  it("only global_emergency_cutoff has global scope", () => {
    const globalTypes = Object.entries(SECURITY_EVENT_POLICY)
      .filter(([, p]) => p.scope === "global")
      .map(([t]) => t);
    expect(globalTypes).toEqual(["global_emergency_cutoff"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. __resetForTests
// ─────────────────────────────────────────────────────────────────────────────

describe("test helper: __resetForTests clears all state", () => {
  it("clears all cutoffs, nonces, global cutoff, and audit log", () => {
    const registry = new SessionRevocationRegistry();

    registry.recordSecurityEvent({
      type: "wallet_compromise",
      targetSubject: WALLET_A,
      reason: "test",
      revokedBefore: T0,
      actor: ADMIN,
    }, T0);

    registry.recordSecurityEvent({
      type: "global_emergency_cutoff",
      targetSubject: "*",
      reason: "test",
      revokedBefore: T0 + 5_000,
      actor: ADMIN,
    }, T0 + 5_000);

    expect(registry.isRevoked(WALLET_A, T0 - 100).revoked).toBe(true);
    expect(registry.getAuditTrail().length).toBeGreaterThan(0);

    registry.__resetForTests();

    expect(registry.isRevoked(WALLET_A, T0 - 100).revoked).toBe(false);
    expect(registry.getAuditTrail()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. HTTP CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

function createMockResponse() {
  let statusCode = 200;
  let body: unknown = undefined;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
    getStatus: () => statusCode,
    getBody: () => body as Record<string, unknown>,
  };
  return res as unknown as Response & {
    getStatus: () => number;
    getBody: () => Record<string, unknown>;
  };
}

function createAdminReq(
  overrides: Partial<AdminRequest> = {},
): AdminRequest {
  return {
    admin: {
      sub: "ops-sec-lead",
      role: "admin",
      scope: ["security:revoke", "security:read"],
      iss: "test",
      aud: "prompt-hash-admin",
      nonce: "n-1",
      issuedAt: T0,
      expiresAt: T0 + 60_000,
    },
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as AdminRequest;
}

describe("HTTP controllers: securityEventControllers", () => {
  beforeEach(() => {
    globalSessionRevocationRegistry.__resetForTests();
  });

  it("POST /invalidate records an event and returns 201", async () => {
    const req = createAdminReq({
      body: {
        type: "credential_change",
        subject: WALLET_A,
        reason: "password rotated",
      },
    });
    const res = createMockResponse();

    await InvalidateSessions(req, res);

    expect(res.getStatus()).toBe(201);
    expect(res.getBody()).toMatchObject({
      success: true,
      event: {
        type: "credential_change",
        targetSubject: WALLET_A,
        actorId: "ops-sec-lead",
      },
    });
    expect(globalSessionRevocationRegistry.isRevoked(WALLET_A, 0).revoked).toBe(true);
  });

  it("POST /invalidate rejects missing or unauthenticated actor with 403", async () => {
    const req = createAdminReq({ admin: undefined });
    const res = createMockResponse();

    await InvalidateSessions(req, res);

    expect(res.getStatus()).toBe(403);
    expect(res.getBody().code).toBe("ACTOR_REQUIRED");
  });

  it("POST /invalidate rejects invalid event types and scope mismatches with 400", async () => {
    const badTypeRes = createMockResponse();
    await InvalidateSessions(
      createAdminReq({ body: { type: "unknown_event", subject: WALLET_A, reason: "r" } }),
      badTypeRes,
    );
    expect(badTypeRes.getStatus()).toBe(400);
    expect(badTypeRes.getBody().code).toBe("INVALID_EVENT_TYPE");

    const mismatchRes = createMockResponse();
    await InvalidateSessions(
      createAdminReq({ body: { type: "credential_change", subject: "*", reason: "r" } }),
      mismatchRes,
    );
    expect(mismatchRes.getStatus()).toBe(400);
    expect(mismatchRes.getBody().code).toBe("invalid_subject");
  });

  it("POST /reinstate clears revocation and returns 404 when subject is not revoked", async () => {
    const notFoundRes = createMockResponse();
    await ReinstateSubject(
      createAdminReq({ body: { subject: WALLET_A, reason: "false alarm" } }),
      notFoundRes,
    );
    expect(notFoundRes.getStatus()).toBe(404);

    await InvalidateSessions(
      createAdminReq({
        body: { type: "suspicious_activity", subject: WALLET_A, reason: "alert" },
      }),
      createMockResponse(),
    );

    const reinstateRes = createMockResponse();
    await ReinstateSubject(
      createAdminReq({ body: { subject: WALLET_A, reason: "verified false positive" } }),
      reinstateRes,
    );
    expect(reinstateRes.getStatus()).toBe(200);
    expect(reinstateRes.getBody()).toMatchObject({
      success: true,
      subject: WALLET_A,
      reinstated: true,
    });
  });

  it("GET /status/:subject and GET /audit return status and filtered audit trail", async () => {
    await InvalidateSessions(
      createAdminReq({
        body: { type: "role_change", subject: WALLET_A, reason: "role updated" },
      }),
      createMockResponse(),
    );

    const statusRes = createMockResponse();
    await GetRevocationStatus(
      createAdminReq({ params: { subject: WALLET_A } as unknown as AdminRequest["params"] }),
      statusRes,
    );
    expect(statusRes.getStatus()).toBe(200);
    expect(statusRes.getBody()).toMatchObject({
      subject: WALLET_A,
      revoked: true,
      code: "subject_revoked_by_security_event",
    });

    const auditRes = createMockResponse();
    await GetSecurityAuditTrail(
      createAdminReq({ query: { type: "role_change", subject: WALLET_A } }),
      auditRes,
    );
    expect(auditRes.getStatus()).toBe(200);
    expect(auditRes.getBody().total).toBe(1);
  });
});
