import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Response } from "express";

vi.mock("../services/auditTrail", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// The route-inventory tests below import the real route modules to inspect
// their middleware chains. Those modules transitively pull in notification
// services with dependencies this test has no need to exercise (and, for
// nodemailer, isn't even declared in package.json) — stub them out so the
// import succeeds without requiring real credentials or network access.
vi.mock("../services/emailNotifications", () => ({
  notifyPromptReported: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/discordNotifications", () => ({
  announceNewPrompt: vi.fn().mockResolvedValue(undefined),
}));

import { requireAdminScope, AdminRequest } from "../middleware/adminAuth";
import { createAdminToken } from "../services/adminToken";
import { recordAuditEvent } from "../services/auditTrail";

const AUDIENCE = "prompt-hash-admin-test";

function makeReq(headers: Record<string, string> = {}): AdminRequest {
  return {
    headers,
    method: "GET",
    baseUrl: "/api/prompts",
    path: "/admin/integrity-report",
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as AdminRequest;
}

function makeRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("requireAdminScope middleware (#542)", () => {
  const originalSecret = process.env.ADMIN_TOKEN_SECRET;
  const originalPrevious = process.env.ADMIN_TOKEN_SECRET_PREVIOUS;
  const originalAudience = process.env.ADMIN_TOKEN_AUDIENCE;

  beforeEach(() => {
    process.env.ADMIN_TOKEN_SECRET = "a-sufficiently-long-admin-secret";
    delete process.env.ADMIN_TOKEN_SECRET_PREVIOUS;
    process.env.ADMIN_TOKEN_AUDIENCE = AUDIENCE;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.ADMIN_TOKEN_SECRET = originalSecret;
    process.env.ADMIN_TOKEN_SECRET_PREVIOUS = originalPrevious;
    process.env.ADMIN_TOKEN_AUDIENCE = originalAudience;
  });

  it("calls next() and attaches the admin payload for a valid, correctly-scoped token", async () => {
    const { token } = createAdminToken(process.env.ADMIN_TOKEN_SECRET!, {
      sub: "ops-jane",
      scope: ["integrity:read"],
      iss: "ops-cli",
      aud: AUDIENCE,
    });
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();
    const next = vi.fn();

    await requireAdminScope("integrity:read")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.admin?.sub).toBe("ops-jane");
    expect(res.status).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin_auth_success", result: "success" }),
    );
  });

  it("rejects a request with no Authorization header", async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await requireAdminScope("integrity:read")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a bare random bearer string the same way a normal session would be rejected", async () => {
    const req = makeReq({ authorization: "Bearer some-random-user-session-token" });
    const res = makeRes();
    const next = vi.fn();

    await requireAdminScope("integrity:read")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin_auth_denied", result: "blocked" }),
    );
  });

  it("rejects a valid token that lacks the scope this route requires", async () => {
    const { token } = createAdminToken(process.env.ADMIN_TOKEN_SECRET!, {
      sub: "ops-jane",
      scope: ["reports:read"], // no integrity:write
      iss: "ops-cli",
      aud: AUDIENCE,
    });
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();
    const next = vi.fn();

    await requireAdminScope("integrity:write")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("fails closed (503) when ADMIN_TOKEN_SECRET is not configured, rather than admitting every request", async () => {
    delete process.env.ADMIN_TOKEN_SECRET;
    const req = makeReq({ authorization: "Bearer anything" });
    const res = makeRes();
    const next = vi.fn();

    await requireAdminScope("integrity:read")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("rejects a token minted for a different deployment audience", async () => {
    const { token } = createAdminToken(process.env.ADMIN_TOKEN_SECRET!, {
      sub: "ops-jane",
      scope: ["integrity:read"],
      iss: "ops-cli",
      aud: "some-other-deployment",
    });
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();
    const next = vi.fn();

    await requireAdminScope("integrity:read")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("route inventory: every privileged endpoint carries the admin guard (#542)", () => {
  it("mounts requireAdminScope ahead of the handler for every admin-only prompt route", async () => {
    // Importing promptRoutes pulls in controllers.ts and its large
    // dependency graph (ai, mongoose, etc.), which esbuild/Vite must
    // transform on first import — allow more time than the default.
    process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27017/prompt-hash-stellar-test";
    const { promptRouter } = await import("../routes/promptRoutes");
    const guardedRoutes: Array<{ method: string; path: string }> = [
      { method: "get", path: "/reports" },
      { method: "get", path: "/admin/integrity-report" },
      { method: "post", path: "/admin/integrity-check" },
    ];

    for (const { method, path } of guardedRoutes) {
      const layer = (promptRouter as any).stack.find(
        (entry: any) => entry.route?.path === path && entry.route.methods[method],
      );
      expect(layer, `route ${method.toUpperCase()} ${path} should be registered`).toBeTruthy();

      const handlerNames = layer.route.stack.map((s: any) => s.name);
      expect(
        handlerNames,
        `route ${method.toUpperCase()} ${path} is missing the admin auth guard in its middleware chain`,
      ).toContain("adminAuthMiddleware");
    }
  }, 20_000);

  it("mounts requireAdminScope ahead of the handler for every admin-only fulfillment route", async () => {
    const { fulfillmentRouter } = await import("../routes/fulfillmentRoutes");
    const guardedPaths = ["/:promptId/:buyerWallet/resolve", "/pending-refunds", "/auto-refund-sweep"];

    for (const path of guardedPaths) {
      const layer = (fulfillmentRouter as any).stack.find(
        (entry: any) => entry.route?.path === path,
      );
      expect(layer, `route ${path} should be registered`).toBeTruthy();

      const handlerNames = layer.route.stack.map((s: any) => s.name);
      expect(
        handlerNames,
        `route ${path} is missing the admin auth guard in its middleware chain`,
      ).toContain("adminAuthMiddleware");
    }
  });
});
