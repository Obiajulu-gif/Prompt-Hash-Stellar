import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../services/auditTrail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/auditTrail")>()),
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { policyLimitRouter } from "../routes/policyLimitRoutes";
import { policyLimitService, POLICIES } from "../services/policyLimitService";
import { createAdminToken } from "../services/adminToken";

/**
 * Permission-diff report before policy override changes (#1036).
 * Drives the real router layers (admin scope check + handler) in order.
 */

const SECRET = "policy-override-diff-test-admin-secret";
const AUDIENCE = "prompt-hash-admin-test";
const OP = "COMPUTE_AI_IMPROVE";
const DEFAULT = POLICIES[OP].defaultLimit;

function bearer(scope: string[]): string {
  const { token } = createAdminToken(SECRET, { sub: "ops-test", scope, iss: "test", aud: AUDIENCE });
  return `Bearer ${token}`;
}

const READ = () => bearer(["ratelimit:read"]);
const WRITE = () => bearer(["ratelimit:write"]);

async function call(
  method: "post" | "delete",
  path: string,
  { body = {}, params = {}, authorization }: { body?: any; params?: any; authorization?: string },
) {
  const layer = (policyLimitRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route.methods[method],
  );
  const req: any = {
    method: method.toUpperCase(),
    baseUrl: "/api/admin/policy-limits",
    path,
    body,
    params,
    headers: authorization ? { authorization } : {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res: any = { statusCode: 200, payload: undefined, headers: {} as Record<string, string> };
  res.setHeader = vi.fn((name: string, value: string) => {
    res.headers[name] = value;
    return res;
  });
  res.status = vi.fn((code: number) => ((res.statusCode = code), res));
  res.json = vi.fn((payload: unknown) => ((res.payload = payload), res));

  for (const { handle } of layer.route.stack) {
    let advanced = false;
    await handle(req, res, () => {
      advanced = true;
    });
    if (!advanced) break;
  }
  return res;
}

const createBody = (overrides: Record<string, unknown> = {}) => ({
  action: "create",
  scopeType: "wallet",
  scopeValue: "GABCDEF",
  operation: OP,
  limit: DEFAULT * 5,
  durationSeconds: 3600,
  reason: "Partner load test",
  ...overrides,
});

async function preview(body: Record<string, unknown>) {
  return call("post", "/overrides/diff", { body, authorization: READ() });
}

describe("policy override permission-diff report (#1036)", () => {
  const originalSecret = process.env.ADMIN_TOKEN_SECRET;
  const originalAudience = process.env.ADMIN_TOKEN_AUDIENCE;

  beforeEach(() => {
    process.env.ADMIN_TOKEN_SECRET = SECRET;
    process.env.ADMIN_TOKEN_AUDIENCE = AUDIENCE;
    policyLimitService.reset();
  });

  afterEach(() => {
    process.env.ADMIN_TOKEN_SECRET = originalSecret;
    process.env.ADMIN_TOKEN_AUDIENCE = originalAudience;
  });

  it("previews a loosening override without applying it", async () => {
    const res = await preview(createBody());

    expect(res.statusCode).toBe(200);
    expect(res.payload.report).toMatchObject({
      action: "create",
      scopeValue: "gabcdef",
      effectiveLimitBefore: DEFAULT,
      effectiveLimitAfter: DEFAULT * 5,
      direction: "loosened",
      affectedOverrideId: null,
      isBroad: false,
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(policyLimitService.getStatus().activeOverrides).toHaveLength(0);
  });

  it("applies a create only with the reviewed digest", async () => {
    const { report } = (await preview(createBody())).payload;

    const res = await call("post", "/overrides", {
      body: { ...createBody(), diffDigest: report.digest },
      authorization: WRITE(),
    });

    expect(res.statusCode).toBe(200);
    expect(policyLimitService.resolveLimit(OP, { wallet: "GABCDEF" }).limit).toBe(DEFAULT * 5);
  });

  it("returns 428 with the report when no digest is supplied", async () => {
    const res = await call("post", "/overrides", { body: createBody(), authorization: WRITE() });

    expect(res.statusCode).toBe(428);
    expect(res.payload).toMatchObject({ code: "diff_required", report: { direction: "loosened" } });
    expect(policyLimitService.getStatus().activeOverrides).toHaveLength(0);
  });

  it("returns 409 with a fresh report when state changed after review (retry path)", async () => {
    const { report: reviewed } = (await preview(createBody())).payload;
    // Another admin lands an override on the same scope first.
    await policyLimitService.addOverride({
      scopeType: "wallet",
      scopeValue: "GABCDEF",
      operation: OP,
      limit: 1,
      durationSeconds: 60,
      reason: "Abuse spike",
      grantedBy: "ops-other",
    });

    const stale = await call("post", "/overrides", {
      body: { ...createBody(), diffDigest: reviewed.digest },
      authorization: WRITE(),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.payload.code).toBe("stale_diff");
    expect(stale.payload.report).toMatchObject({
      effectiveLimitBefore: 1,
      affectedOverrideId: expect.any(String),
    });
    expect(policyLimitService.resolveLimit(OP, { wallet: "GABCDEF" }).limit).toBe(1);

    // Retrying with the re-reviewed digest succeeds.
    const retried = await call("post", "/overrides", {
      body: { ...createBody(), diffDigest: stale.payload.report.digest },
      authorization: WRITE(),
    });
    expect(retried.statusCode).toBe(200);
    expect(policyLimitService.resolveLimit(OP, { wallet: "GABCDEF" }).limit).toBe(DEFAULT * 5);
  });

  it("rejects a digest reviewed for a different limit", async () => {
    const { report } = (await preview(createBody({ limit: 1 }))).payload;

    const res = await call("post", "/overrides", {
      body: { ...createBody(), diffDigest: report.digest },
      authorization: WRITE(),
    });
    expect(res.statusCode).toBe(409);
    expect(policyLimitService.getStatus().activeOverrides).toHaveLength(0);
  });

  it("marks global overrides as broad and reports revocation fallback", async () => {
    const global = await preview(createBody({ scopeType: "global", scopeValue: "*", limit: 2 }));
    expect(global.payload.report).toMatchObject({ isBroad: true, direction: "tightened" });

    const created = await policyLimitService.addOverride({
      scopeType: "global",
      scopeValue: "*",
      operation: OP,
      limit: 2,
      durationSeconds: 60,
      reason: "Incident",
      grantedBy: "ops-test",
    });
    const wallet = await policyLimitService.addOverride({
      scopeType: "wallet",
      scopeValue: "GABCDEF",
      operation: OP,
      limit: 50,
      durationSeconds: 60,
      reason: "Partner",
      grantedBy: "ops-test",
    });

    // Revoking the wallet override falls back to the active global override.
    const revokeWallet = await preview({ action: "revoke", overrideId: wallet.overrideId });
    expect(revokeWallet.payload.report).toMatchObject({
      effectiveLimitBefore: 50,
      effectiveLimitAfter: 2,
      direction: "tightened",
    });

    // Revoking the global override falls back to the policy default.
    const revokeGlobal = await preview({ action: "revoke", overrideId: created.overrideId });
    expect(revokeGlobal.payload.report).toMatchObject({
      effectiveLimitBefore: 2,
      effectiveLimitAfter: DEFAULT,
      direction: "loosened",
      isBroad: true,
    });
  });

  it("revokes only with the reviewed digest", async () => {
    const created = await policyLimitService.addOverride({
      scopeType: "ip",
      scopeValue: "10.0.0.1",
      operation: OP,
      limit: 1,
      durationSeconds: 60,
      reason: "Abuse",
      grantedBy: "ops-test",
    });
    const params = { overrideId: created.overrideId };

    const missing = await call("delete", "/overrides/:overrideId", {
      params,
      body: { reason: "Resolved" },
      authorization: WRITE(),
    });
    expect(missing.statusCode).toBe(428);

    const { report } = (await preview({ action: "revoke", overrideId: created.overrideId })).payload;
    const revoked = await call("delete", "/overrides/:overrideId", {
      params,
      body: { reason: "Resolved", diffDigest: report.digest },
      authorization: WRITE(),
    });
    expect(revoked.statusCode).toBe(200);
    expect(policyLimitService.getStatus().activeOverrides).toHaveLength(0);
  });

  it("returns 404 for a revoke preview of an unknown override", async () => {
    const res = await preview({ action: "revoke", overrideId: "povr_missing" });
    expect(res.statusCode).toBe(404);
  });

  it("validates the change before reporting", async () => {
    expect((await preview(createBody({ scopeType: "global", scopeValue: "all" }))).statusCode).toBe(400);
    expect((await preview(createBody({ scopeType: "tenant" }))).statusCode).toBe(400);
    expect((await preview(createBody({ limit: -1 }))).statusCode).toBe(400);
    expect((await preview({ action: "replace" })).statusCode).toBe(400);
  });

  it("requires an admin token with the right scope", async () => {
    const anonymous = await call("post", "/overrides/diff", { body: createBody() });
    expect(anonymous.statusCode).toBe(401);

    // A read-only token can preview but cannot apply.
    const { report } = (await preview(createBody())).payload;
    const readOnly = await call("post", "/overrides", {
      body: { ...createBody(), diffDigest: report.digest },
      authorization: READ(),
    });
    expect(readOnly.statusCode).toBe(401);
    expect(policyLimitService.getStatus().activeOverrides).toHaveLength(0);
  });
});
