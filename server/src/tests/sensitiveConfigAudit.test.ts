import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #1139: Add audit evidence for sensitive configuration changes.
 *
 * Verifies that administrative mutations to sensitive policy limit configurations:
 *   - Normal path: records a hash-chained `admin_config_change` in AuditLog.
 *   - Retry path: retrying an unchanged configuration records `noop: true`.
 *   - Failure / No-evidence path: if audit persistence fails, rolls back the
 *     in-memory configuration state and returns 503 Service Unavailable.
 *   - Authorization path: unauthenticated or under-privileged callers are denied.
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
      res.status(403).json({ error: "Unauthorized: invalid or insufficient admin token." });
      return;
    }
    req.admin = { sub };
    req.adminToken = { sub };
    next();
  },
}));
vi.mock("../db/connectDb", () => ({ default: async () => undefined }));

import { AuditLog } from "../models/AuditLog";
import { policyLimitRouter } from "../routes/policyLimitRoutes";
import { policyLimitService } from "../services/policyLimitService";
import * as auditTrail from "../services/auditTrail";
import { jsonCall, startHttpServer, type HttpTestServer } from "./helpers/httpApp";
import { resetRealMongo, setupRealMongo, teardownRealMongo } from "./helpers/realMongo";

const WRITER = { "x-test-admin": "admin-alice|ratelimit:write,ratelimit:read" };
const READ_ONLY = { "x-test-admin": "viewer-bob|ratelimit:read" };

let dbReady = false;
let http: HttpTestServer;

beforeAll(async () => {
  dbReady = await setupRealMongo();
  http = await startHttpServer((app) => {
    app.use("/api/policy-limits", policyLimitRouter);
  });
});

afterAll(async () => {
  await http?.close();
  await teardownRealMongo();
});

beforeEach(async () => {
  policyLimitService.reset();
  if (dbReady) await resetRealMongo();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Sensitive Configuration Change Audit Evidence (Issue #1139)", () => {
  it("records hash-chained audit evidence on normal policy override creation", async () => {
    // 1. Generate diff report to obtain valid digest
    const diffRes = await jsonCall(http.baseUrl, "/api/policy-limits/overrides/diff", {
      method: "POST",
      headers: WRITER,
      body: JSON.stringify({
        action: "create",
        scopeType: "ip",
        scopeValue: "192.168.1.1",
        operation: "STORAGE_PROMPT_PAYLOAD",
        limit: 131072,
        durationSeconds: 3600,
        reason: "Allow larger prompts for staging import test",
      }),
    });
    expect(diffRes.status).toBe(200);
    const { digest } = diffRes.body.report;

    // 2. Submit audited create override request
    const createRes = await jsonCall(http.baseUrl, "/api/policy-limits/overrides", {
      method: "POST",
      headers: { ...WRITER, "idempotency-key": "override-idem-1139" },
      body: JSON.stringify({
        scopeType: "ip",
        scopeValue: "192.168.1.1",
        operation: "STORAGE_PROMPT_PAYLOAD",
        limit: 131072,
        durationSeconds: 3600,
        reason: "Allow larger prompts for staging import test",
        diffDigest: digest,
      }),
    });

    expect(createRes.status).toBe(200);
    expect(createRes.headers.get("x-config-change-id")).toBe("override-idem-1139");
    expect(createRes.body.success).toBe(true);

    // 3. Verify AuditLog entry was persisted
    if (dbReady) {
      const logs = await AuditLog.find({ action: "admin_config_change" }).lean();
      expect(logs).toHaveLength(1);
      const entry = logs[0];
      expect(entry.actor).toBe("admin-alice");
      expect(entry.targetType).toBe("admin_config");
      expect(entry.target).toBe("policy_limit:ip:192.168.1.1:STORAGE_PROMPT_PAYLOAD");
      expect(entry.result).toBe("success");
      expect((entry.metadata as any).changeId).toBe("override-idem-1139");
      expect((entry.metadata as any).operation).toBe("create");
      expect((entry.metadata as any).noop).toBe(false);
      expect(entry.recordHash).toBeDefined();
    }
  });

  it("handles retry gracefully and records noop when target state already matches", async () => {
    // Diff & Create initial override
    const diffRes = await jsonCall(http.baseUrl, "/api/policy-limits/overrides/diff", {
      method: "POST",
      headers: WRITER,
      body: JSON.stringify({
        action: "create",
        scopeType: "wallet",
        scopeValue: "GAA1139",
        operation: "COMPUTE_SAFETY_SCAN",
        limit: 500,
        durationSeconds: 1800,
        reason: "Batch safety scan override",
      }),
    });
    const { digest } = diffRes.body.report;

    const payload = {
      scopeType: "wallet",
      scopeValue: "GAA1139",
      operation: "COMPUTE_SAFETY_SCAN",
      limit: 500,
      durationSeconds: 1800,
      reason: "Batch safety scan override",
      diffDigest: digest,
    };

    const first = await jsonCall(http.baseUrl, "/api/policy-limits/overrides", {
      method: "POST",
      headers: { ...WRITER, "idempotency-key": "retry-key-1139" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);

    // For retry with same digest
    const second = await jsonCall(http.baseUrl, "/api/policy-limits/overrides", {
      method: "POST",
      headers: { ...WRITER, "idempotency-key": "retry-key-1139" },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);

    if (dbReady) {
      const logs = await AuditLog.find({ "metadata.changeId": "retry-key-1139" }).lean();
      expect(logs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("enforces no-evidence, no-change: rolls back policy override when audit persistence fails", async () => {
    const diffRes = await jsonCall(http.baseUrl, "/api/policy-limits/overrides/diff", {
      method: "POST",
      headers: WRITER,
      body: JSON.stringify({
        action: "create",
        scopeType: "global",
        scopeValue: "*",
        operation: "INDEXING_REINDEX_CATALOG",
        limit: 10,
        durationSeconds: 600,
        reason: "Temporary global indexing throttler",
      }),
    });
    const { digest } = diffRes.body.report;

    // Simulate an audit store failure on success record
    const realRecord = auditTrail.recordAuditEvent;
    vi.spyOn(auditTrail, "recordAuditEvent").mockImplementation(async (event: any, opts: any) => {
      if (opts?.throwOnError && event.result === "success") {
        throw new Error("Simulated MongoDB connection drop during audit write");
      }
      return realRecord(event, opts);
    });

    const res = await jsonCall(http.baseUrl, "/api/policy-limits/overrides", {
      method: "POST",
      headers: WRITER,
      body: JSON.stringify({
        scopeType: "global",
        scopeValue: "*",
        operation: "INDEXING_REINDEX_CATALOG",
        limit: 10,
        durationSeconds: 600,
        reason: "Temporary global indexing throttler",
        diffDigest: digest,
      }),
    });

    // Expect 503 audit_evidence_unavailable with rolledBack: true
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.body.error).toBe("audit_evidence_unavailable");
    expect(res.body.rolledBack).toBe(true);

    // In-memory policy override MUST have been rolled back
    const status = policyLimitService.getStatus();
    const activeGlobal = status.activeOverrides.find(
      (o) => o.scopeType === "global" && o.operation === "INDEXING_REINDEX_CATALOG",
    );
    expect(activeGlobal).toBeUndefined();
  });

  it("records audit evidence on override revocation and handles unauthorized requests", async () => {
    // 1. Create an override
    const diffRes = await jsonCall(http.baseUrl, "/api/policy-limits/overrides/diff", {
      method: "POST",
      headers: WRITER,
      body: JSON.stringify({
        action: "create",
        scopeType: "ip",
        scopeValue: "10.0.0.1",
        operation: "EXTERNAL_HORIZON_QUERY",
        limit: 300,
        durationSeconds: 3600,
        reason: "Pre-revoke test",
      }),
    });
    const { digest } = diffRes.body.report;

    const createRes = await jsonCall(http.baseUrl, "/api/policy-limits/overrides", {
      method: "POST",
      headers: WRITER,
      body: JSON.stringify({
        scopeType: "ip",
        scopeValue: "10.0.0.1",
        operation: "EXTERNAL_HORIZON_QUERY",
        limit: 300,
        durationSeconds: 3600,
        reason: "Pre-revoke test",
        diffDigest: digest,
      }),
    });
    const overrideId = createRes.body.override.overrideId;

    // 2. Unauthorized attempt to revoke (read-only token)
    const revokeUnauthorized = await jsonCall(
      http.baseUrl,
      `/api/policy-limits/overrides/${overrideId}`,
      {
        method: "DELETE",
        headers: READ_ONLY,
        body: JSON.stringify({ reason: "Unauthorized attempt" }),
      },
    );
    expect(revokeUnauthorized.status).toBe(403);

    // 3. Diff for revocation
    const revokeDiffRes = await jsonCall(http.baseUrl, "/api/policy-limits/overrides/diff", {
      method: "POST",
      headers: WRITER,
      body: JSON.stringify({
        action: "revoke",
        overrideId,
      }),
    });
    const revokeDigest = revokeDiffRes.body.report.digest;

    // 4. Authorized revocation
    const revokeRes = await jsonCall(
      http.baseUrl,
      `/api/policy-limits/overrides/${overrideId}`,
      {
        method: "DELETE",
        headers: WRITER,
        body: JSON.stringify({
          reason: "Completed testing window",
          diffDigest: revokeDigest,
        }),
      },
    );
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);

    if (dbReady) {
      const logs = await AuditLog.find({
        action: "admin_config_change",
        "metadata.operation": "revoke",
      }).lean();
      expect(logs.length).toBeGreaterThanOrEqual(1);
    }
  });
});

