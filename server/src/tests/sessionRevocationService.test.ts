import { describe, expect, it, beforeEach } from "vitest";
import {
  SessionRevocationRegistry,
  SessionRevocationError,
  RevocationActor,
  normalizeSubject,
} from "../services/sessionRevocationService";
import {
  createAdminToken,
  verifyAdminToken,
  AdminTokenError,
  __clearRevokedAdminTokensForTests,
} from "../services/adminToken";

const ADMIN_ACTOR: RevocationActor = {
  id: "ops-sec-lead",
  role: "admin",
  permissions: new Set(["admin", "security:revoke"]),
};

const UNAUTHORIZED_ACTOR: RevocationActor = {
  id: "guest-user",
  role: "viewer",
  permissions: new Set(["prompts:read"]),
};

const ADMIN_SECRET = "admin-token-test-secret-12345678";
const AUDIENCE = "production";

describe("Stale Session and Token Revocation After Security Events (#1031)", () => {
  let registry: SessionRevocationRegistry;

  beforeEach(() => {
    registry = new SessionRevocationRegistry();
    __clearRevokedAdminTokensForTests();
  });

  it("permits valid sessions when no security revocation is active", () => {
    const wallet = "GBZXN7PIRZGNMHGA728R374OXZW6W5Y45PNM26QCOHOHOGIPLDTZQK7U";
    const issuedAt = Date.now() - 5000;
    const status = registry.isRevoked(wallet, issuedAt, "nonce-1");

    expect(status.revoked).toBe(false);
  });

  it("revokes existing sessions for a subject following a security event", () => {
    const wallet = "GBZXN7PIRZGNMHGA728R374OXZW6W5Y45PNM26QCOHOHOGIPLDTZQK7U";
    const t0 = 1_000_000;
    const oldSessionIssuedAt = t0;

    // Record security event (e.g. suspicious activity or key compromise reported)
    const securityEventTime = t0 + 10_000;
    registry.recordSecurityEvent(
      {
        type: "wallet_compromise",
        targetSubject: wallet,
        reason: "Suspected private key leakage reported by creator",
        revokedBefore: securityEventTime,
        actor: ADMIN_ACTOR,
      },
      securityEventTime,
    );

    // Old session issued at t0 is revoked
    const checkOld = registry.isRevoked(wallet, oldSessionIssuedAt, "nonce-old", securityEventTime + 1000);
    expect(checkOld.revoked).toBe(true);
    expect(checkOld.code).toBe("subject_revoked_by_security_event");
    expect(checkOld.reason).toContain("Suspected private key leakage");

    // New session issued after the security event (re-authenticated via fresh challenge) is allowed
    const newSessionIssuedAt = securityEventTime + 5_000;
    const checkNew = registry.isRevoked(wallet, newSessionIssuedAt, "nonce-new", securityEventTime + 6000);
    expect(checkNew.revoked).toBe(false);
  });

  it("revokes a specific token nonce without affecting other tokens for the same subject", () => {
    const subject = "ops-alice";
    const t0 = 1_000_000;

    registry.recordSecurityEvent(
      {
        type: "explicit_logout_all",
        targetSubject: subject,
        targetNonce: "compromised-nonce-99",
        reason: "Specific token logout",
        revokedBefore: t0 - 1000, // cutoff is in the past, so only nonce is targeted
        actor: ADMIN_ACTOR,
      },
      t0,
    );

    // Token with the targeted nonce is revoked
    const checkBadNonce = registry.isRevoked(subject, t0 + 100, "compromised-nonce-99", t0 + 200);
    expect(checkBadNonce.revoked).toBe(true);
    expect(checkBadNonce.code).toBe("token_nonce_revoked");

    // Token with a different nonce for the same subject is permitted
    const checkGoodNonce = registry.isRevoked(subject, t0 + 100, "safe-nonce-100", t0 + 200);
    expect(checkGoodNonce.revoked).toBe(false);
  });

  it("applies global emergency cutoff to invalidate all sessions platform-wide", () => {
    const t0 = 1_000_000;
    const wallet1 = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GNOEDVLQC5WWXBXRXG2V";
    const wallet2 = "GBZXN7PIRZGNMHGA728R374OXZW6W5Y45PNM26QCOHOHOGIPLDTZQK7U";

    // Emergency secret rotation triggers global cutoff
    registry.recordSecurityEvent(
      {
        type: "global_emergency_cutoff",
        targetSubject: "*",
        reason: "Emergency root key rotation",
        revokedBefore: t0,
        actor: ADMIN_ACTOR,
      },
      t0,
    );

    // Both wallets' old sessions are revoked
    expect(registry.isRevoked(wallet1, t0 - 10, "n1", t0 + 10).revoked).toBe(true);
    expect(registry.isRevoked(wallet2, t0 - 5, "n2", t0 + 10).revoked).toBe(true);
    expect(registry.isRevoked(wallet1, t0 - 10, "n1", t0 + 10).code).toBe("global_security_event");

    // New sessions minted after cutoff are valid
    expect(registry.isRevoked(wallet1, t0 + 1, "n3", t0 + 10).revoked).toBe(false);
  });

  it("rejects unauthorized actors attempting to record security revocations", () => {
    expect(() =>
      registry.recordSecurityEvent({
        type: "wallet_compromise",
        targetSubject: "GBZXN7PIRZGNMHGA728R374OXZW6W5Y45PNM26QCOHOHOGIPLDTZQK7U",
        reason: "Malicious revoke attempt",
        actor: UNAUTHORIZED_ACTOR,
      }),
    ).toThrow(SessionRevocationError);
  });

  it("handles duplicate revocation events idempotently", () => {
    const subject = "ops-bob";
    const t0 = 1_000_000;

    registry.recordSecurityEvent(
      {
        type: "permission_revocation",
        targetSubject: subject,
        reason: "First event",
        revokedBefore: t0,
        actor: ADMIN_ACTOR,
      },
      t0,
    );

    registry.recordSecurityEvent(
      {
        type: "permission_revocation",
        targetSubject: subject,
        reason: "Second duplicate/extended event",
        revokedBefore: t0 + 500,
        actor: ADMIN_ACTOR,
      },
      t0 + 500,
    );

    // Check that newer cutoff t0 + 500 is in effect
    expect(registry.isRevoked(subject, t0 + 200, "n1", t0 + 600).revoked).toBe(true);
    expect(registry.isRevoked(subject, t0 + 600, "n2", t0 + 700).revoked).toBe(false);
  });

  it("supports recovery/rollback via reinstateSubject for false-alarm security events", () => {
    const subject = "ops-charlie";
    const t0 = 1_000_000;

    registry.recordSecurityEvent(
      {
        type: "suspicious_activity",
        targetSubject: subject,
        reason: "False alarm breach",
        revokedBefore: t0,
        actor: ADMIN_ACTOR,
      },
      t0,
    );

    expect(registry.isRevoked(subject, t0 - 50, "n1", t0).revoked).toBe(true);

    // Reinstate subject
    const reinstated = registry.reinstateSubject(subject, ADMIN_ACTOR, "Verified false alarm incident");
    expect(reinstated).toBe(true);

    // Token is now valid again
    expect(registry.isRevoked(subject, t0 - 50, "n1", t0).revoked).toBe(false);
  });

  it("integrates with admin token verification", () => {
    const now = 2_000_000;
    const { token, payload } = createAdminToken(
      ADMIN_SECRET,
      {
        sub: "ops-dan",
        scope: ["integrity:read"],
        iss: "security-team",
        aud: AUDIENCE,
      },
      now,
    );

    // Initially valid
    const verified = verifyAdminToken(
      ADMIN_SECRET,
      token,
      { audience: AUDIENCE, requiredScope: "integrity:read" },
      now + 100,
    );
    expect(verified.sub).toBe("ops-dan");
  });

  it("normalizes Stellar addresses to uppercase and handles lowercase inputs", () => {
    const lower = "gahr4lj4jnngs6ehs2s3jq6s4hya6hrnhrfvu2lyq6lklngd2lq7b6ub";
    expect(normalizeSubject(lower)).toBe(lower.toUpperCase());
    expect(normalizeSubject("*")).toBe("*");
    expect(normalizeSubject("  ops-Jane  ")).toBe("ops-jane");
  });
});
