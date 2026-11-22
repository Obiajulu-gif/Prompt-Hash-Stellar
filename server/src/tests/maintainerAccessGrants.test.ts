import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Time-boxed maintainer access grants (#912).
 *
 * The model and audit trail are mocked, so the tests cover the decision logic,
 * the issue/revoke IO paths (including rollback when evidence cannot be written),
 * and the enforcement middleware's deny and allow branches.
 */

vi.mock("../services/auditTrail", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../models/MaintainerAccessGrant", () => ({
  default: {
    create: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
  },
  MAINTAINER_GRANT_SCOPES: [
    "moderation:write",
    "payouts:write",
    "integrity:write",
    "entitlements:write",
    "flags:write",
  ],
}));

import MaintainerAccessGrant from "../models/MaintainerAccessGrant";
import { recordAuditEvent } from "../services/auditTrail";
import {
  MAINTAINER_GRANT_DEFAULT_TTL_MS,
  MAINTAINER_GRANT_MAX_TTL_MS,
  MaintainerGrantError,
  buildMaintainerGrantReport,
  evaluateMaintainerGrant,
  issueMaintainerGrant,
  revokeMaintainerGrant,
  summarizeMaintainerGrant,
  validateMaintainerGrantRequest,
  type MaintainerGrantRecord,
} from "../services/maintainerAccessGrants";
import { requireMaintainerGrant } from "../middleware/maintainerAccess";

const NOW = new Date("2026-02-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function makeGrant(overrides: Partial<MaintainerGrantRecord> = {}): MaintainerGrantRecord {
  return {
    grantId: "mag_test-1",
    grantee: "maint-bob",
    approver: "ops-jane",
    scopes: ["payouts:write"],
    reason: "INC-4421 payout reconciliation",
    issuedAt: new Date(NOW.getTime() - HOUR),
    expiresAt: new Date(NOW.getTime() + HOUR),
    revokedAt: null,
    revokedBy: null,
    useCount: 0,
    ...overrides,
  };
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    grantee: "maint-bob",
    approver: "ops-jane",
    scopes: ["payouts:write"],
    reason: "INC-4421 payout reconciliation",
    ...overrides,
  };
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateMaintainerGrantRequest", () => {
  it("accepts a well-formed request and applies the default lifetime", () => {
    const validated = validateMaintainerGrantRequest(validRequest());
    expect(validated).toEqual({
      grantee: "maint-bob",
      approver: "ops-jane",
      scopes: ["payouts:write"],
      reason: "INC-4421 payout reconciliation",
      ttlMs: MAINTAINER_GRANT_DEFAULT_TTL_MS,
    });
  });

  it("refuses self-approval, ignoring case", () => {
    try {
      validateMaintainerGrantRequest(validRequest({ approver: "MAINT-BOB" }));
      throw new Error("expected self_approval_forbidden");
    } catch (err) {
      expect((err as MaintainerGrantError).code).toBe("self_approval_forbidden");
    }
  });

  it("refuses scopes outside the maintainer allow-list", () => {
    expect(() =>
      validateMaintainerGrantRequest(validRequest({ scopes: ["admin:everything"] })),
    ).toThrow(MaintainerGrantError);
    try {
      validateMaintainerGrantRequest(validRequest({ scopes: ["support:use"] }));
    } catch (err) {
      expect((err as MaintainerGrantError).code).toBe("invalid_scopes");
    }
  });

  it("refuses a reason that is too short to justify access", () => {
    try {
      validateMaintainerGrantRequest(validRequest({ reason: "fix it" }));
      throw new Error("expected invalid_reason");
    } catch (err) {
      expect((err as MaintainerGrantError).code).toBe("invalid_reason");
    }
  });

  it("refuses lifetimes beyond the 72 hour ceiling or below five minutes", () => {
    for (const ttlMs of [MAINTAINER_GRANT_MAX_TTL_MS + 1, 60 * 1000]) {
      try {
        validateMaintainerGrantRequest(validRequest({ ttlMs }));
        throw new Error("expected invalid_ttl");
      } catch (err) {
        expect((err as MaintainerGrantError).code).toBe("invalid_ttl");
      }
    }
  });
});

describe("evaluateMaintainerGrant", () => {
  const context = { grantee: "maint-bob", scope: "payouts:write", now: NOW };

  it("allows a live grant with the right grantee and scope", () => {
    const decision = evaluateMaintainerGrant(makeGrant(), context);
    expect(decision.ok).toBe(true);
  });

  it("denies a missing grant", () => {
    expect(evaluateMaintainerGrant(null, context)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("denies a revoked grant even when it has not expired", () => {
    const decision = evaluateMaintainerGrant(makeGrant({ revokedAt: NOW }), context);
    expect(decision).toMatchObject({ ok: false, code: "revoked" });
  });

  it("treats the expiry instant itself as expired", () => {
    const decision = evaluateMaintainerGrant(makeGrant({ expiresAt: NOW }), context);
    expect(decision).toMatchObject({ ok: false, code: "expired" });
  });

  it("denies a different maintainer using the grant", () => {
    const decision = evaluateMaintainerGrant(makeGrant(), { ...context, grantee: "maint-eve" });
    expect(decision).toMatchObject({ ok: false, code: "grantee_mismatch" });
  });

  it("denies a scope the grant does not carry", () => {
    const decision = evaluateMaintainerGrant(makeGrant(), { ...context, scope: "flags:write" });
    expect(decision).toMatchObject({ ok: false, code: "scope_not_granted" });
  });
});

describe("maintainer grant report", () => {
  it("buckets grants into active, expired, and revoked with counts", () => {
    const grants = [
      makeGrant({ grantId: "a" }),
      makeGrant({ grantId: "e", expiresAt: new Date(NOW.getTime() - 1) }),
      makeGrant({ grantId: "r", revokedAt: NOW, revokedBy: "ops-jane" }),
    ];
    const report = buildMaintainerGrantReport(grants, NOW);
    expect(report.counts).toEqual({ active: 1, expired: 1, revoked: 1 });
    expect(report.active.map((g) => g.grantId)).toEqual(["a"]);
    expect(report.expired.map((g) => g.grantId)).toEqual(["e"]);
    expect(report.revoked[0]).toMatchObject({ grantId: "r", revokedBy: "ops-jane", status: "revoked" });
    expect(report.generatedAt).toBe(NOW.toISOString());
  });

  it("summarizes a grant with ISO timestamps and its status", () => {
    const summary = summarizeMaintainerGrant(makeGrant(), NOW);
    expect(summary.status).toBe("active");
    expect(summary.expiresAt).toBe(new Date(NOW.getTime() + HOUR).toISOString());
  });
});

describe("issueMaintainerGrant", () => {
  it("creates the grant with the approver recorded and audits the issuance", async () => {
    vi.mocked(MaintainerAccessGrant.create).mockResolvedValue({} as any);

    const result = await issueMaintainerGrant(validRequest(), { now: NOW, requestId: "req-1" });

    expect(result.grantId).toMatch(/^mag_/);
    expect(result.expiresAt.getTime()).toBe(NOW.getTime() + MAINTAINER_GRANT_DEFAULT_TTL_MS);
    expect(MaintainerAccessGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({ grantee: "maint-bob", approver: "ops-jane", useCount: 0 }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "maintainer_grant_issued",
        actor: "ops-jane",
        requestId: "req-1",
      }),
      { throwOnError: true },
    );
  });

  it("removes the grant again when its audit evidence cannot be written", async () => {
    vi.mocked(MaintainerAccessGrant.create).mockResolvedValue({} as any);
    vi.mocked(recordAuditEvent).mockRejectedValueOnce(new Error("audit store down"));

    await expect(issueMaintainerGrant(validRequest(), { now: NOW })).rejects.toThrow(
      "audit store down",
    );
    const createdId = vi.mocked(MaintainerAccessGrant.create).mock.calls[0][0].grantId;
    expect(MaintainerAccessGrant.deleteOne).toHaveBeenCalledWith({ grantId: createdId });
  });

  it("never creates a grant that fails validation", async () => {
    await expect(
      issueMaintainerGrant(validRequest({ approver: "maint-bob" }), { now: NOW }),
    ).rejects.toMatchObject({ code: "self_approval_forbidden" });
    expect(MaintainerAccessGrant.create).not.toHaveBeenCalled();
  });
});

describe("revokeMaintainerGrant", () => {
  it("revokes a live grant and audits it", async () => {
    vi.mocked(MaintainerAccessGrant.findOne).mockReturnValue({
      lean: async () => makeGrant(),
    } as any);
    vi.mocked(MaintainerAccessGrant.findOneAndUpdate).mockResolvedValue({} as any);

    const result = await revokeMaintainerGrant("mag_test-1", { actor: "ops-jane", now: NOW });

    expect(result).toEqual({ revoked: true, grantId: "mag_test-1" });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "maintainer_grant_revoked", actor: "ops-jane" }),
      { throwOnError: true },
    );
  });

  it("is idempotent for an already revoked or unknown grant", async () => {
    vi.mocked(MaintainerAccessGrant.findOne).mockReturnValueOnce({
      lean: async () => makeGrant({ revokedAt: NOW }),
    } as any);
    expect(await revokeMaintainerGrant("mag_test-1", { actor: "ops-jane" })).toEqual({
      revoked: false,
      grantId: "mag_test-1",
    });

    vi.mocked(MaintainerAccessGrant.findOne).mockReturnValueOnce({ lean: async () => null } as any);
    expect(await revokeMaintainerGrant("mag_missing", { actor: "ops-jane" })).toEqual({
      revoked: false,
      grantId: "mag_missing",
    });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe("requireMaintainerGrant middleware", () => {
  const guard = requireMaintainerGrant("payouts:write", { now: () => NOW });

  function makeReq(headers: Record<string, string> = { "x-maintainer-grant-id": "mag_test-1" }, sub: string | null = "maint-bob") {
    return {
      method: "POST",
      baseUrl: "/api/payouts",
      path: "/release",
      headers,
      socket: { remoteAddress: "127.0.0.1" },
      admin: sub ? { sub } : undefined,
    } as any;
  }

  function mockLookup(grant: MaintainerGrantRecord | null) {
    vi.mocked(MaintainerAccessGrant.findOne).mockReturnValue({ lean: async () => grant } as any);
  }

  it("fails closed when mounted without admin authentication", async () => {
    const res = mockRes();
    const next = vi.fn();
    await guard(makeReq({ "x-maintainer-grant-id": "mag_test-1" }, null), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
    expect(MaintainerAccessGrant.findOne).not.toHaveBeenCalled();
  });

  it("requires the grant header", async () => {
    const res = mockRes();
    const next = vi.fn();
    await guard(makeReq({}), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "missing_grant" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("denies an expired grant at the authorization boundary without counting a use", async () => {
    mockLookup(makeGrant({ expiresAt: new Date(NOW.getTime() - 1) }));
    const res = mockRes();
    const next = vi.fn();
    await guard(makeReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "expired" }));
    expect(MaintainerAccessGrant.findOneAndUpdate).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("denies a grant used for a scope it does not carry", async () => {
    mockLookup(makeGrant({ scopes: ["flags:write"] }));
    const res = mockRes();
    await guard(makeReq(), res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "scope_not_granted" }));
  });

  it("denies a grant presented by a different maintainer", async () => {
    mockLookup(makeGrant());
    const res = mockRes();
    await guard(makeReq({ "x-maintainer-grant-id": "mag_test-1" }, "maint-eve"), res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "grantee_mismatch" }));
  });

  it("returns 404 for an unknown grant", async () => {
    mockLookup(null);
    const res = mockRes();
    await guard(makeReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("admits a live grant, counts the use, audits it, and attaches the grant", async () => {
    mockLookup(makeGrant());
    vi.mocked(MaintainerAccessGrant.findOneAndUpdate).mockReturnValue({
      lean: async () => makeGrant({ useCount: 1 }),
    } as any);
    const res = mockRes();
    const next = vi.fn();
    const req = makeReq();

    await guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.maintainerGrant).toMatchObject({ grantId: "mag_test-1", scopes: ["payouts:write"] });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "maintainer_grant_used", result: "success", actor: "maint-bob" }),
      { throwOnError: true },
    );
  });

  it("does not run the handler when the use cannot be evidenced", async () => {
    mockLookup(makeGrant());
    vi.mocked(MaintainerAccessGrant.findOneAndUpdate).mockReturnValue({
      lean: async () => makeGrant({ useCount: 1 }),
    } as any);
    vi.mocked(recordAuditEvent).mockRejectedValueOnce(new Error("audit store down"));
    const res = mockRes();
    const next = vi.fn();

    await guard(makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });
});
