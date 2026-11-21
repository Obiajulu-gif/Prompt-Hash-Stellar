/**
 * Tests — expiring capability grants for sensitive actions (#1171).
 *
 * Coverage:
 *  - normal: issue then consume once for the matching subject/action/resource;
 *  - failure: unknown, expired, revoked and already-used grants are denied;
 *  - retry: a denied attempt never burns the grant, so the correct retry works;
 *  - authorization: self-approval, action allow-list, TTL bounds, subject and
 *    resource binding, admin-only issuance/revocation, and middleware denials;
 *  - hygiene: only a token digest is stored, inspection never returns the
 *    token, the store is bounded, and expired grants can be pruned.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/structuredLogger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  CAPABILITY_GRANT_DEFAULT_TTL_MS,
  CAPABILITY_GRANT_MAX_TTL_MS,
  CAPABILITY_GRANT_MIN_TTL_MS,
  CapabilityGrantError,
  CapabilityGrantStore,
  capabilityGrantStatus,
  capabilityGrantRemedy,
  consumeCapabilityGrant,
  evaluateCapabilityGrant,
  hashCapabilityToken,
  inspectCapabilityGrant,
  issueCapabilityGrant,
  revokeCapabilityGrant,
  validateCapabilityGrantRequest,
} from "../services/capabilityGrants";
import { requireCapabilityGrant } from "../middleware/capabilityGrant";
import {
  GetCapabilityGrant,
  IssueCapabilityGrant,
  RevokeCapabilityGrant,
} from "../controllers/capabilityGrantControllers";

// ── helpers ──────────────────────────────────────────────────────────────────

const NOW = 1_750_000_000_000;

function request(overrides: Record<string, unknown> = {}) {
  return {
    subject: "g-alice",
    action: "prompt.delete",
    resource: "prompt-1",
    approver: "g-admin",
    reason: "ticket SEC-1171 cleanup",
    ...overrides,
  } as any;
}

function issue(store: CapabilityGrantStore, overrides: Record<string, unknown> = {}, now = NOW) {
  return issueCapabilityGrant(request(overrides), { store, now });
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined, locals: {} };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.json = (body: unknown) => ((res.body = body), res);
  return res;
}

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    body: {},
    headers: {},
    params: {},
    ...overrides,
  } as any;
}

// ── normal path ──────────────────────────────────────────────────────────────

describe("normal path", () => {
  it("issues a digest-only grant and consumes it exactly once", () => {
    const store = new CapabilityGrantStore();
    const issued = issue(store);

    expect(issued.grantId).toMatch(/^capg_/);
    expect(issued.token).toMatch(/^cap_[0-9a-f]{64}$/);
    expect(issued.expiresAt).toBe(NOW + CAPABILITY_GRANT_DEFAULT_TTL_MS);

    const record = store.findByGrantId(issued.grantId)!;
    expect(record.tokenHash).toBe(hashCapabilityToken(issued.token));
    expect(record).not.toHaveProperty("token");
    expect(JSON.stringify(inspectCapabilityGrant(issued.grantId, NOW, store))).not.toContain(
      issued.token,
    );

    const first = consumeCapabilityGrant(
      issued.token,
      { subject: "g-alice", action: "prompt.delete", resource: "prompt-1", now: NOW + 1 },
      store,
    );
    expect(first.ok).toBe(true);

    const second = consumeCapabilityGrant(
      issued.token,
      { subject: "g-alice", action: "prompt.delete", resource: "prompt-1", now: NOW + 2 },
      store,
    );
    expect(second).toEqual(
      expect.objectContaining({ ok: false, code: "already_used" }),
    );
    expect(capabilityGrantStatus(record, NOW + 2)).toBe("used");
    expect(inspectCapabilityGrant(issued.grantId, NOW + 2, store)?.usedAt).not.toBeNull();
  });

  it("accepts a wildcard-resource grant for any concrete resource", () => {
    const store = new CapabilityGrantStore();
    const issued = issue(store, { resource: "*" });
    const decision = consumeCapabilityGrant(
      issued.token,
      { subject: "g-alice", action: "prompt.delete", resource: "prompt-99", now: NOW + 1 },
      store,
    );
    expect(decision.ok).toBe(true);
  });
});

// ── failure paths ────────────────────────────────────────────────────────────

describe("failure paths", () => {
  it("denies an unknown token without throwing", () => {
    const store = new CapabilityGrantStore();
    expect(
      consumeCapabilityGrant(
        "cap_deadbeef",
        { subject: "g-alice", action: "prompt.delete", resource: "prompt-1", now: NOW },
        store,
      ),
    ).toEqual(expect.objectContaining({ ok: false, code: "not_found" }));
    expect(
      consumeCapabilityGrant(
        "",
        { subject: "g-alice", action: "prompt.delete", resource: "prompt-1", now: NOW },
        store,
      ),
    ).toEqual(expect.objectContaining({ ok: false, code: "not_found" }));
  });

  it("denies at the exact expiry boundary and leaves the grant unused", () => {
    const store = new CapabilityGrantStore();
    const issued = issue(store, { ttlMs: 5_000 });
    const expiry = NOW + 5_000;

    const denied = consumeCapabilityGrant(
      issued.token,
      { subject: "g-alice", action: "prompt.delete", resource: "prompt-1", now: expiry },
      store,
    );
    expect(denied).toEqual(expect.objectContaining({ ok: false, code: "expired" }));
    expect(store.findByGrantId(issued.grantId)!.usedAt).toBeNull();
    expect(inspectCapabilityGrant(issued.grantId, expiry, store)?.status).toBe("expired");
  });

  it("denies a revoked grant even inside its validity window", () => {
    const store = new CapabilityGrantStore();
    const issued = issue(store);
    const revocation = revokeCapabilityGrant(
      issued.grantId,
      { actor: "g-admin", now: NOW + 10 },
      store,
    );
    expect(revocation).toEqual({ revoked: true, grantId: issued.grantId });

    expect(
      consumeCapabilityGrant(
        issued.token,
        { subject: "g-alice", action: "prompt.delete", resource: "prompt-1", now: NOW + 11 },
        store,
      ),
    ).toEqual(expect.objectContaining({ ok: false, code: "revoked" }));
  });

  it("rejects a second revocation without overwriting the first", () => {
    const store = new CapabilityGrantStore();
    const issued = issue(store);
    revokeCapabilityGrant(issued.grantId, { actor: "first", now: NOW + 1 }, store);
    expect(revokeCapabilityGrant(issued.grantId, { actor: "second", now: NOW + 2 }, store)).toEqual({
      revoked: false,
      grantId: issued.grantId,
    });
    expect(store.findByGrantId(issued.grantId)!.revokedBy).toBe("first");
    expect(revokeCapabilityGrant("capg_missing", { actor: "x" }, store).revoked).toBe(false);
  });

  it("prunes only expired, unused grants", () => {
    const store = new CapabilityGrantStore();
    const expired = issue(store, { resource: "prompt-1", ttlMs: 5_000 });
    const live = issue(store, { resource: "prompt-2" });
    const used = issue(store, { resource: "prompt-3", ttlMs: 5_000 });
    consumeCapabilityGrant(
      used.token,
      { subject: "g-alice", action: "prompt.delete", resource: "prompt-3", now: NOW + 1 },
      store,
    );

    expect(store.pruneExpired(NOW + 10_000)).toBe(1);
    expect(store.findByGrantId(expired.grantId)).toBeUndefined();
    expect(store.findByGrantId(live.grantId)).toBeDefined();
    expect(store.findByGrantId(used.grantId)).toBeDefined();
  });

  it("evicts the oldest grant when the bounded store is full", () => {
    const store = new CapabilityGrantStore({ maxRecords: 2 });
    const first = issue(store, { resource: "p1" });
    const second = issue(store, { resource: "p2" });
    const third = issue(store, { resource: "p3" });

    expect(store.size).toBe(2);
    expect(store.findByGrantId(first.grantId)).toBeUndefined();
    expect(store.findByTokenHash(hashCapabilityToken(first.token))).toBeUndefined();
    expect(store.findByGrantId(second.grantId)).toBeDefined();
    expect(store.findByGrantId(third.grantId)).toBeDefined();
  });
});

// ── retry semantics ──────────────────────────────────────────────────────────

describe("retry semantics", () => {
  it("does not burn a grant on a mismatched attempt, then accepts the correct retry", () => {
    const store = new CapabilityGrantStore();
    const issued = issue(store);

    const wrongSubject = consumeCapabilityGrant(
      issued.token,
      { subject: "g-mallory", action: "prompt.delete", resource: "prompt-1", now: NOW + 1 },
      store,
    );
    expect(wrongSubject).toEqual(
      expect.objectContaining({ ok: false, code: "subject_mismatch" }),
    );

    const wrongAction = consumeCapabilityGrant(
      issued.token,
      { subject: "g-alice", action: "payout.release", resource: "prompt-1", now: NOW + 2 },
      store,
    );
    expect(wrongAction).toEqual(
      expect.objectContaining({ ok: false, code: "action_mismatch" }),
    );

    const wrongResource = consumeCapabilityGrant(
      issued.token,
      { subject: "g-alice", action: "prompt.delete", resource: "prompt-2", now: NOW + 3 },
      store,
    );
    expect(wrongResource).toEqual(
      expect.objectContaining({ ok: false, code: "resource_mismatch" }),
    );

    expect(store.findByGrantId(issued.grantId)!.usedAt).toBeNull();

    const retry = consumeCapabilityGrant(
      issued.token,
      { subject: "G-Alice", action: "prompt.delete", resource: "prompt-1", now: NOW + 4 },
      store,
    );
    expect(retry.ok).toBe(true);
  });
});

// ── issuance validation / authorization ─────────────────────────────────────

describe("issuance validation", () => {
  it("normalizes identities and preserves the requested bounded TTL", () => {
    const validated = validateCapabilityGrantRequest(
      request({ subject: "  G-Alice ", approver: "G-Admin", ttlMs: CAPABILITY_GRANT_MAX_TTL_MS }),
    );
    expect(validated).toEqual(
      expect.objectContaining({
        subject: "g-alice",
        approver: "g-admin",
        action: "prompt.delete",
        resource: "prompt-1",
        ttlMs: CAPABILITY_GRANT_MAX_TTL_MS,
      }),
    );
  });

  it("rejects self-approval", () => {
    expect(() =>
      validateCapabilityGrantRequest(request({ approver: "G-ALICE" })),
    ).toThrowError(CapabilityGrantError);
    try {
      validateCapabilityGrantRequest(request({ approver: "G-ALICE" }));
    } catch (err) {
      expect((err as CapabilityGrantError).code).toBe("self_approval_forbidden");
    }
  });

  it.each([
    ["invalid_subject", { subject: "   " }],
    ["invalid_approver", { approver: "" }],
    ["invalid_action", { action: "prompt.publish" }],
    ["invalid_resource", { resource: " " }],
    ["invalid_resource", { resource: "a\nb" }],
    ["invalid_resource", { resource: "x".repeat(257) }],
    ["invalid_reason", { reason: "short" }],
    ["invalid_ttl", { ttlMs: CAPABILITY_GRANT_MIN_TTL_MS - 1 }],
    ["invalid_ttl", { ttlMs: CAPABILITY_GRANT_MAX_TTL_MS + 1 }],
    ["invalid_ttl", { ttlMs: 1500.5 }],
    ["invalid_ttl", { ttlMs: Number.NaN }],
  ])("rejects %s", (code, overrides) => {
    try {
      validateCapabilityGrantRequest(request(overrides));
      throw new Error("expected validation to throw");
    } catch (err) {
      expect((err as CapabilityGrantError).code).toBe(code);
    }
  });

  it("keeps the pure evaluation order stable (revoked beats expiry and identity)", () => {
    const decision = evaluateCapabilityGrant(
      {
        grantId: "g1",
        tokenHash: "h",
        subject: "alice",
        action: "prompt.delete",
        resource: "p1",
        approver: "admin",
        reason: "reason123",
        issuedAt: NOW,
        expiresAt: NOW - 1,
        usedAt: NOW - 2,
        revokedAt: NOW - 3,
        revokedBy: "admin",
      },
      { subject: "bob", action: "payout.release", resource: "p2", now: NOW },
    );
    expect(decision).toEqual(expect.objectContaining({ ok: false, code: "revoked" }));
  });

  it("gives every denial code a remedy", () => {
    for (const code of [
      "not_found",
      "revoked",
      "expired",
      "subject_mismatch",
      "action_mismatch",
      "resource_mismatch",
      "already_used",
    ] as const) {
      expect(capabilityGrantRemedy(code).length).toBeGreaterThan(10);
    }
  });
});

// ── middleware authorization ─────────────────────────────────────────────────

describe("requireCapabilityGrant middleware", () => {
  function middlewareFor(store: CapabilityGrantStore, overrides: Record<string, unknown> = {}) {
    return requireCapabilityGrant({
      action: "prompt.delete",
      resource: (req) => (req.body as any)?.promptId,
      resolveSubject: (req) => req.walletAddress,
      store,
      now: () => NOW + 1,
      ...overrides,
    });
  }

  it("denies a missing token with 401 before calling the handler", () => {
    const store = new CapabilityGrantStore();
    const res = mockRes();
    const next = vi.fn();
    middlewareFor(store)(mockReq(), res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("CAPABILITY_TOKEN_REQUIRED");
    expect(next).not.toHaveBeenCalled();
  });

  it("consumes the grant, attaches its summary, and calls next once", () => {
    const store = new CapabilityGrantStore();
    const issued = issue(store);
    const req = mockReq({
      headers: { "x-capability-grant": issued.token },
      body: { promptId: "prompt-1" },
      walletAddress: "g-alice",
    });
    const res = mockRes();
    const next = vi.fn();

    middlewareFor(store)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.capabilityGrant?.grantId).toBe(issued.grantId);
    expect(req.capabilityGrant?.status).toBe("used");
    expect(res.locals.capabilityGrant.grantId).toBe(issued.grantId);
    expect(store.findByGrantId(issued.grantId)!.usedAt).toBe(NOW + 1);
  });

  it.each([
    [
      "action mismatch",
      { headers: { "x-capability-grant": "TOKEN" }, body: { promptId: "prompt-1" }, walletAddress: "g-alice" },
      "action_mismatch",
      "payout.release",
    ],
    [
      "missing subject",
      { headers: { "x-capability-grant": "TOKEN" }, body: { promptId: "prompt-1" } },
      "subject_mismatch",
      "prompt.delete",
    ],
    [
      "missing resource",
      { headers: { "x-capability-grant": "TOKEN" }, body: {}, walletAddress: "g-alice" },
      "resource_mismatch",
      "prompt.delete",
    ],
    [
      "expired grant",
      { headers: { "x-capability-grant": "TOKEN" }, body: { promptId: "prompt-1" }, walletAddress: "g-alice" },
      "expired",
      "prompt.delete",
    ],
  ])("denies %s with 403", (_label, reqOverrides, code, action) => {
    const store = new CapabilityGrantStore();
    const issued = issue(store, { ttlMs: 5_000 });
    const req = mockReq({
      ...reqOverrides,
      headers: {
        ...(reqOverrides.headers as Record<string, string>),
        "x-capability-grant": issued.token,
      },
    });
    const res = mockRes();
    const next = vi.fn();

    requireCapabilityGrant({
      action,
      resource: (r) => (r.body as any)?.promptId,
      resolveSubject: (r) => r.walletAddress,
      store,
      now: () => (code === "expired" ? NOW + 10_000 : NOW + 1),
    })(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe(code);
    expect(typeof res.body.remedy).toBe("string");
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses a replay of an already-consumed token", () => {
    const store = new CapabilityGrantStore();
    const issued = issue(store);
    const make = () =>
      mockReq({
        headers: { "x-capability-grant": issued.token },
        body: { promptId: "prompt-1" },
        walletAddress: "g-alice",
      });
    const mw = middlewareFor(store);

    const first = mockRes();
    mw(make(), first, vi.fn());
    expect(first.statusCode).toBe(200);

    const second = mockRes();
    const next = vi.fn();
    mw(make(), second, next);
    expect(second.statusCode).toBe(403);
    expect(second.body.code).toBe("already_used");
    expect(next).not.toHaveBeenCalled();
  });
});

// ── controller authorization ─────────────────────────────────────────────────

describe("capability grant controllers", () => {
  beforeEach(() => {
    // Nothing global to reset: each controller test issues its own fresh grant.
  });

  it("denies issuance without a verified admin approver", async () => {
    const res = mockRes();
    await IssueCapabilityGrant(mockReq({ body: request() }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("APPROVER_REQUIRED");
  });

  it("takes the approver from the verified token and ignores body.approver", async () => {
    const res = mockRes();
    await IssueCapabilityGrant(
      mockReq({
        admin: { sub: "admin-token-subject", role: "admin", scopes: ["capability:write"] },
        body: { ...request({ subject: "g-controller-normal" }), approver: "g-body-spoof" },
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(res.body.approver).toBe("admin-token-subject");
    expect(res.body.token).toMatch(/^cap_/);

    const decision = consumeCapabilityGrant(res.body.token, {
      subject: "g-controller-normal",
      action: "prompt.delete",
      resource: "prompt-1",
      now: Date.now(),
    });
    expect(decision.ok).toBe(true);
  });

  it("maps validation failures to 400 with a stable code", async () => {
    const res = mockRes();
    await IssueCapabilityGrant(
      mockReq({
        admin: { sub: "admin-a" },
        body: request({ action: "prompt.nope" }),
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("invalid_action");
  });

  it("returns 404 for an unknown grant and a token-free summary for a known one", async () => {
    const missing = mockRes();
    await GetCapabilityGrant(mockReq({ params: { grantId: "capg_nope" } }), missing);
    expect(missing.statusCode).toBe(404);

    const issuedRes = mockRes();
    await IssueCapabilityGrant(
      mockReq({
        admin: { sub: "admin-inspector" },
        body: request({ subject: "g-inspect" }),
      }),
      issuedRes,
    );

    const found = mockRes();
    await GetCapabilityGrant(
      mockReq({ params: { grantId: issuedRes.body.grantId } }),
      found,
    );
    expect(found.statusCode).toBe(200);
    expect(found.body.grant.status).toBe("active");
    expect(JSON.stringify(found.body)).not.toContain(issuedRes.body.token);
    expect(found.body.grant).not.toHaveProperty("tokenHash");
  });

  it("revokes with the verified actor and is idempotent", async () => {
    // The controller revokes from the process-wide store, so issue there too.
    const issued = issueCapabilityGrant(request({ subject: "g-revoke" }));
    const req = mockReq({
      admin: { sub: "admin-revoker" },
      params: { grantId: issued.grantId },
    });

    const first = mockRes();
    await RevokeCapabilityGrant(req, first);
    expect(first.statusCode).toBe(200);
    expect(first.body).toEqual({ revoked: true, grantId: issued.grantId });

    const second = mockRes();
    await RevokeCapabilityGrant(req, second);
    expect(second.body).toEqual({ revoked: false, grantId: issued.grantId });
    expect(inspectCapabilityGrant(issued.grantId)?.revokedBy).toBe("admin-revoker");
  });

  it("denies revocation without an authenticated actor", async () => {
    const res = mockRes();
    await RevokeCapabilityGrant(mockReq({ params: { grantId: "capg_x" } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("ACTOR_REQUIRED");
  });
});
