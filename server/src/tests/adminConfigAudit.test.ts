import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit evidence for administrative configuration changes (#1026).
 *
 * Runs the real feature-flag routes, AuditLog hash chain, and FeatureFlag
 * model against an in-memory mongod. Only `requireAdminScope` is replaced
 * with a header-driven stub (HMAC token handling is covered by
 * adminAuth.test.ts) so the authorization path can be exercised without
 * minting tokens.
 */

vi.mock("../middleware/adminAuth", () => ({
  requireAdminScope: (scope: string) => (req: any, res: any, next: any) => {
    const header = req.headers["x-test-admin"];
    if (!header) {
      res.status(401).json({ error: "Unauthorized: admin bearer token required." });
      return;
    }
    const [sub, scopes] = String(header).split("|");
    if (!scopes.split(",").includes(scope)) {
      res.status(401).json({ error: "Unauthorized: invalid or insufficient admin token." });
      return;
    }
    req.admin = { sub };
    next();
  },
}));
vi.mock("../db/connectDb", () => ({ default: async () => undefined }));

import { AuditLog } from "../models/AuditLog";
import FeatureFlag from "../models/FeatureFlag";
import { featureFlagRouter } from "../routes/featureFlagRoutes";
import { auditRouter } from "../routes/auditRoutes";
import { verifyAuditTrail } from "../services/auditTrail";
import { diffConfigState } from "../services/adminConfigAudit";
import { snapshotFlag } from "../services/featureFlagService";
import { jsonCall, startHttpServer, type HttpTestServer } from "./helpers/httpApp";
import { resetRealMongo, setupRealMongo, teardownRealMongo } from "./helpers/realMongo";

const WRITER = { "x-test-admin": "ops-alice|flags:write,flags:read" };
const AUDITOR = { "x-test-admin": "auditor-bob|audit:export" };
const READ_ONLY = { "x-test-admin": "viewer|flags:read" };

let dbReady = false;
let http: HttpTestServer;

beforeAll(async () => {
  dbReady = await setupRealMongo();
  http = await startHttpServer((app) => {
    app.use("/api/flags", featureFlagRouter);
    app.use("/api/audit", auditRouter);
  });
});

afterAll(async () => {
  await http?.close();
  await teardownRealMongo();
});

beforeEach(async () => {
  if (dbReady) await resetRealMongo();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createFlag(headers: Record<string, string> = WRITER, extra: Record<string, unknown> = {}) {
  return jsonCall(http.baseUrl, "/api/flags", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Strict_Settlement_Checks",
      description: "verify tx hash before granting entitlement",
      status: "disabled",
      environments: { development: true },
      createdBy: "spoofed-in-body",
      ...extra,
    }),
  });
}

async function configChanges() {
  return AuditLog.find({ action: "admin_config_change" }).sort({ createdAt: 1, _id: 1 }).lean();
}

describe("diffConfigState", () => {
  it("lists only top-level fields whose values changed, ignoring key order", () => {
    expect(
      diffConfigState(
        { status: "disabled", environments: { a: true, b: false }, rolloutPercentage: 0 },
        { rolloutPercentage: 0, environments: { b: false, a: true }, status: "enabled" },
      ),
    ).toEqual(["status"]);
    expect(diffConfigState(null, { status: "enabled" })).toEqual(["status"]);
    expect(diffConfigState({ status: "enabled" }, null)).toEqual(["status"]);
  });
});

describe("feature flag changes leave audit evidence (#1026)", () => {
  it("normal path: create, update, delete each record actor, before/after and changed fields", async () => {
    if (!dbReady) return;

    const created = await createFlag(WRITER, { reason: "INC-42 rollout" });
    expect(created.status).toBe(200);
    expect(created.headers.get("x-config-change-id")).toBeTruthy();
    // The authenticated admin is the creator, not the body-supplied value.
    expect(created.body.createdBy).toBe("ops-alice");

    const updated = await jsonCall(http.baseUrl, "/api/flags/strict_settlement_checks", {
      method: "PATCH",
      headers: WRITER,
      body: JSON.stringify({ status: "enabled", rolloutPercentage: 25 }),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe("enabled");

    const deleted = await jsonCall(http.baseUrl, "/api/flags/strict_settlement_checks", {
      method: "DELETE",
      headers: WRITER,
    });
    expect(deleted.status).toBe(200);

    const rows = await configChanges();
    expect(rows.map((r: any) => r.metadata.operation)).toEqual(["create", "update", "delete"]);
    expect(rows.every((r: any) => r.result === "success" && r.actor === "ops-alice")).toBe(true);
    expect(rows.every((r: any) => r.target === "feature_flag:strict_settlement_checks")).toBe(true);

    const [create, update, del] = rows as any[];
    expect(create.beforeState).toBeNull();
    expect(create.afterState.status).toBe("disabled");
    expect(create.reason).toBe("INC-42 rollout");
    expect(update.beforeState.status).toBe("disabled");
    expect(update.afterState.status).toBe("enabled");
    expect(update.metadata.changedFields).toEqual(["rolloutPercentage", "status"]);
    expect(del.afterState).toBeNull();

    // Evidence is part of the tamper-evident hash chain.
    const verification = await verifyAuditTrail();
    expect(verification.valid).toBe(true);
  });

  it("failure path: a rejected change is recorded as a failure and leaves config untouched", async () => {
    if (!dbReady) return;

    const missing = await jsonCall(http.baseUrl, "/api/flags/does_not_exist", {
      method: "PATCH",
      headers: WRITER,
      body: JSON.stringify({ status: "enabled" }),
    });
    expect(missing.status).toBe(400);

    const rows = await configChanges();
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toBe("failure");
    expect(rows[0].metadata.operation).toBe("update");
    expect(rows[0].metadata.error).toMatch(/not found/i);
    expect(await FeatureFlag.countDocuments()).toBe(0);
  });

  it("no evidence, no change: an audit write failure rolls the change back and returns 503", async () => {
    if (!dbReady) return;

    expect((await createFlag()).status).toBe(200);
    const before = await FeatureFlag.findOne({ name: "strict_settlement_checks" }).lean();

    const create = AuditLog.create.bind(AuditLog);
    vi.spyOn(AuditLog, "create").mockImplementation(async (doc: any) => {
      if (doc.action === "admin_config_change") throw new Error("audit store offline");
      return create(doc);
    });

    const res = await jsonCall(http.baseUrl, "/api/flags/strict_settlement_checks", {
      method: "PATCH",
      headers: WRITER,
      body: JSON.stringify({ status: "enabled", environments: { production: true } }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.body).toMatchObject({ error: "audit_evidence_unavailable", rolledBack: true });

    const after = await FeatureFlag.findOne({ name: "strict_settlement_checks" }).lean();
    // Restored to the same effective configuration that was audited before.
    expect(snapshotFlag(after)).toEqual(snapshotFlag(before));
    expect(after.status).toBe("disabled");
  });

  it("no evidence, no change: a create whose evidence fails is removed again", async () => {
    if (!dbReady) return;

    vi.spyOn(AuditLog, "create").mockRejectedValue(new Error("audit store offline"));
    const res = await createFlag();
    expect(res.status).toBe(503);
    expect(await FeatureFlag.countDocuments()).toBe(0);
  });

  it("retry path: replaying the same change is recorded as a no-op under the same change id", async () => {
    if (!dbReady) return;
    expect((await createFlag()).status).toBe(200);

    const patch = () =>
      jsonCall(http.baseUrl, "/api/flags/strict_settlement_checks", {
        method: "PATCH",
        headers: { ...WRITER, "idempotency-key": "chg-retry-1" },
        body: JSON.stringify({ status: "enabled" }),
      });
    expect((await patch()).status).toBe(200);
    const retry = await patch();
    expect(retry.status).toBe(200);
    expect(retry.headers.get("x-config-change-id")).toBe("chg-retry-1");

    const evidence = await jsonCall(
      http.baseUrl,
      "/api/audit/config-changes?changeId=chg-retry-1",
      { headers: AUDITOR },
    );
    expect(evidence.status).toBe(200);
    expect(evidence.body.records.map((r: any) => r.noop)).toEqual([true, false]);
    expect(evidence.body.records[1].changedFields).toEqual(["status"]);
  });

  it("rejects an unsafe rollout before writing and accepts a healthy retry", async () => {
    if (!dbReady) return;
    expect((await createFlag()).status).toBe(200);
    const update = (errorRate: number) =>
      jsonCall(http.baseUrl, "/api/flags/strict_settlement_checks", {
        method: "PATCH",
        headers: WRITER,
        body: JSON.stringify({
          status: "experimental",
          rolloutPercentage: 10,
          rolloutHealth: { errorRate, p1Incident: false, invariantViolations: 0 },
        }),
      });

    const blocked = await update(0.2);
    expect(blocked.status).toBe(409);
    expect(blocked.body.requireRollback).toBe(true);
    expect((await FeatureFlag.findOne({ name: "strict_settlement_checks" }).lean()).status).toBe("disabled");
    const retry = await update(0.01);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ status: "experimental", rolloutPercentage: 10 });
  });

  it("emergency disable is audited, and an audit outage does not block the kill switch", async () => {
    if (!dbReady) return;
    expect(
      (await createFlag(WRITER, { status: "enabled", environments: { production: true } })).status,
    ).toBe(200);

    const disable = () =>
      jsonCall(http.baseUrl, "/api/flags/strict_settlement_checks/emergency-disable", {
        method: "POST",
        headers: WRITER,
        body: JSON.stringify({ reason: "INC-7 settlement drift" }),
      });

    const first = await disable();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ auditRecorded: true, reason: "INC-7 settlement drift" });
    expect(first.body.flag.status).toBe("disabled");
    expect(first.body.verification.verified).toBe(false);
    const record: any = await AuditLog.findOne({ "metadata.operation": "emergency_disable" }).lean();
    expect(record.afterState.environments).toEqual({ development: false, staging: false, production: false });

    // Re-enable, then disable during an audit outage: the change must stick.
    await FeatureFlag.updateOne({ name: "strict_settlement_checks" }, { $set: { status: "enabled" } });
    vi.spyOn(AuditLog, "create").mockRejectedValue(new Error("audit store offline"));
    const second = await disable();
    expect(second.status).toBe(200);
    expect(second.body.auditRecorded).toBe(false);
    expect((await FeatureFlag.findOne({ name: "strict_settlement_checks" }).lean()).status).toBe("disabled");
  });

  it("authorization path: callers without flags:write cannot change config and leave no change record", async () => {
    if (!dbReady) return;

    expect((await createFlag({})).status).toBe(401);
    expect((await createFlag(READ_ONLY)).status).toBe(401);
    expect(await FeatureFlag.countDocuments()).toBe(0);
    expect(await configChanges()).toHaveLength(0);
  });

  it("evidence query requires audit:export and validates filters", async () => {
    if (!dbReady) return;
    expect((await createFlag()).status).toBe(200);

    const denied = await jsonCall(http.baseUrl, "/api/audit/config-changes", { headers: WRITER });
    expect(denied.status).toBe(401);

    const bad = await jsonCall(http.baseUrl, "/api/audit/config-changes?configKey=x", {
      headers: AUDITOR,
    });
    expect(bad.status).toBe(400);

    const ok = await jsonCall(
      http.baseUrl,
      "/api/audit/config-changes?configType=feature_flag&configKey=STRICT_SETTLEMENT_CHECKS",
      { headers: AUDITOR },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.count).toBe(1);
    expect(ok.body.records[0]).toMatchObject({
      actor: "ops-alice",
      operation: "create",
      result: "success",
    });
    expect(ok.body.records[0].recordHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("maintenance banner audit action (#1026 regression)", () => {
  it("persists admin_maintenance_change instead of failing schema validation", async () => {
    if (!dbReady) return;
    const { recordMaintenanceChange } = await import("../services/auditTrail");
    await recordMaintenanceChange({
      actor: "ops-alice",
      bannerId: "banner-1",
      scopes: ["global"],
      afterState: { enabled: true },
    });
    expect(await AuditLog.countDocuments({ action: "admin_maintenance_change" })).toBe(1);
  });
});
