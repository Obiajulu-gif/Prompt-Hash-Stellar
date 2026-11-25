import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";

vi.mock("../middleware/adminAuth", () => ({
  requireAdminScope: (scope: string) => (req: any, res: any, next: any) => {
    const header = req.headers["x-test-admin"];
    if (!header) {
      res
        .status(401)
        .json({ error: "Unauthorized: admin bearer token required." });
      return;
    }
    const [sub, scopes] = String(header).split("|");
    const scopeList = scopes ? scopes.split(",") : [];
    if (!scopeList.includes(scope) && !scopeList.includes("admin")) {
      res
        .status(401)
        .json({ error: "Unauthorized: invalid or insufficient admin token." });
      return;
    }
    req.admin = {
      sub: sub || "admin-maintainer-test",
      role: "admin",
      scopes: scopeList,
    };
    next();
  },
}));

import { dryRunRouter } from "../routes/dryRunRoutes";

describe("Dry-Run Maintainer Routes API (#1140)", () => {
  let server: Server;
  let base: string;

  const AUTH_HEADER = {
    headers: {
      "Content-Type": "application/json",
      "x-test-admin": "maintainer-alice|policy:evaluate,admin",
    },
  };

  const LIMITED_AUTH_HEADER = {
    headers: {
      "Content-Type": "application/json",
      "x-test-admin": "operator-bob|prompts:read",
    },
  };

  const samplePrompts = [
    {
      id: "p1",
      version: 1,
      status: "active",
      priceXlm: 250,
      creator: "G1111",
      tags: ["ai", "crypto"],
    },
    {
      id: "p2",
      version: 2,
      status: "paused",
      priceXlm: 120,
      creator: "G2222",
      tags: ["deprecated"],
    },
    {
      id: "p3",
      version: 3,
      status: "active",
      priceXlm: 40,
      creator: "G3333",
      tags: ["utility"],
    },
  ];

  const sampleDestructivePolicy = {
    id: "policy-retire-deprecated",
    name: "Retire Deprecated Prompts",
    targetResource: "prompts",
    predicate: { field: "status", operator: "eq", value: "paused" },
    action: "inactivity_retire",
    parameters: { targetStatus: "retired" },
    requiredPermission: "policy:evaluate",
    isDestructive: true,
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/admin/dry-run", dryRunRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}/api/admin/dry-run`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe("Normal Path: Preview Evaluation and Confirmation", () => {
    it("evaluates a destructive dry-run policy and returns diffs and confirmation token", async () => {
      const res = await fetch(`${base}/evaluate`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({
          policy: sampleDestructivePolicy,
          records: samplePrompts,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.policyId).toBe("policy-retire-deprecated");
      expect(data.data.scannedCount).toBe(3);
      expect(data.data.affectedCount).toBe(1);
      expect(data.data.irreversibleCount).toBe(1);
      expect(data.data.affectedPreviews[0].recordId).toBe("p2");
      expect(data.data.affectedPreviews[0].isIrreversible).toBe(true);
      expect(data.data.confirmationToken).toBeDefined();
    });

    it("successfully confirms execution with a valid confirmation token", async () => {
      // 1. Evaluate preview
      const evalRes = await fetch(`${base}/evaluate`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({
          policy: sampleDestructivePolicy,
          records: samplePrompts,
        }),
      });
      const evalData = await evalRes.json();
      const { confirmationToken } = evalData.data;

      // 2. Confirm execution
      const confirmRes = await fetch(`${base}/confirm`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({
          confirmationToken,
          policyId: sampleDestructivePolicy.id,
          targetResource: sampleDestructivePolicy.targetResource,
          affectedRecordSummaries: [{ id: "p2", version: 2 }],
          totalFinancialImpactXlm: 0,
        }),
      });

      expect(confirmRes.status).toBe(200);
      const confirmData = await confirmRes.json();
      expect(confirmData.success).toBe(true);
      expect(confirmData.executedRecordsCount).toBe(1);
      expect(confirmData.policyId).toBe("policy-retire-deprecated");
      expect(confirmData.executedAt).toBeDefined();
    });
  });

  describe("Failure Path: Validation and Drift Detection", () => {
    it("rejects evaluation when policy or records are missing (400)", async () => {
      const res1 = await fetch(`${base}/evaluate`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({ records: samplePrompts }),
      });
      expect(res1.status).toBe(400);
      const data1 = await res1.json();
      expect(data1.code).toBe("invalid_policy");

      const res2 = await fetch(`${base}/evaluate`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({ policy: sampleDestructivePolicy }),
      });
      expect(res2.status).toBe(400);
      const data2 = await res2.json();
      expect(data2.code).toBe("invalid_records");
    });

    it("rejects evaluation when record set exceeds maxEvaluatedRecords limit (400)", async () => {
      const res = await fetch(`${base}/evaluate`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({
          policy: sampleDestructivePolicy,
          records: samplePrompts,
          options: { maxEvaluatedRecords: 2 },
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("selection_too_large");
    });

    it("rejects confirmation when parameters are missing (400)", async () => {
      const res = await fetch(`${base}/confirm`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({ policyId: "policy-retire-deprecated" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("missing_parameters");
    });

    it("rejects confirmation when records have drifted or token is invalid (409 Conflict)", async () => {
      // Evaluate preview
      const evalRes = await fetch(`${base}/evaluate`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({
          policy: sampleDestructivePolicy,
          records: samplePrompts,
        }),
      });
      const evalData = await evalRes.json();
      const { confirmationToken } = evalData.data;

      // Attempt confirm with drifted version (version 3 instead of 2)
      const driftedRes = await fetch(`${base}/confirm`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({
          confirmationToken,
          policyId: sampleDestructivePolicy.id,
          targetResource: sampleDestructivePolicy.targetResource,
          affectedRecordSummaries: [{ id: "p2", version: 3 }],
          totalFinancialImpactXlm: 0,
        }),
      });

      expect(driftedRes.status).toBe(409);
      const driftedData = await driftedRes.json();
      expect(driftedData.code).toBe("confirmation_mismatch");
      expect(driftedData.remediation).toBeDefined();
    });
  });

  describe("Authorization Path: Scope Enforcement", () => {
    it("denies access when no authentication token is provided (401)", async () => {
      const res = await fetch(`${base}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy: sampleDestructivePolicy,
          records: samplePrompts,
        }),
      });
      expect(res.status).toBe(401);
    });

    it("denies access when actor lacks policy:evaluate or admin scope (401)", async () => {
      const res = await fetch(`${base}/evaluate`, {
        method: "POST",
        ...LIMITED_AUTH_HEADER,
        body: JSON.stringify({
          policy: sampleDestructivePolicy,
          records: samplePrompts,
        }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("Retry Path: Recovery from Drift / Conflict", () => {
    it("recovers from drift by re-evaluating preview and successfully confirming with fresh token", async () => {
      // Step 1: Initial evaluation with version 1
      const stalePrompts = [
        { id: "p2", version: 1, status: "paused", priceXlm: 120, creator: "G2222", tags: ["deprecated"] },
      ];
      const initialEval = await fetch(`${base}/evaluate`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({
          policy: sampleDestructivePolicy,
          records: stalePrompts,
        }),
      });
      const initialData = await initialEval.json();
      const staleToken = initialData.data.confirmationToken;

      // Step 2: Record drifted in DB to version 2; confirm fails with 409
      const failedConfirm = await fetch(`${base}/confirm`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({
          confirmationToken: staleToken,
          policyId: sampleDestructivePolicy.id,
          targetResource: sampleDestructivePolicy.targetResource,
          affectedRecordSummaries: [{ id: "p2", version: 2 }],
          totalFinancialImpactXlm: 0,
        }),
      });
      expect(failedConfirm.status).toBe(409);

      // Step 3: Retry - fetch fresh records and re-evaluate
      const refreshedPrompts = [
        { id: "p2", version: 2, status: "paused", priceXlm: 120, creator: "G2222", tags: ["deprecated"] },
      ];
      const freshEval = await fetch(`${base}/evaluate`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({
          policy: sampleDestructivePolicy,
          records: refreshedPrompts,
        }),
      });
      const freshData = await freshEval.json();
      const freshToken = freshData.data.confirmationToken;

      // Step 4: Confirm with fresh token succeeds
      const successfulConfirm = await fetch(`${base}/confirm`, {
        method: "POST",
        ...AUTH_HEADER,
        body: JSON.stringify({
          confirmationToken: freshToken,
          policyId: sampleDestructivePolicy.id,
          targetResource: sampleDestructivePolicy.targetResource,
          affectedRecordSummaries: [{ id: "p2", version: 2 }],
          totalFinancialImpactXlm: 0,
        }),
      });
      expect(successfulConfirm.status).toBe(200);
      const confirmResult = await successfulConfirm.json();
      expect(confirmResult.success).toBe(true);
      expect(confirmResult.executedRecordsCount).toBe(1);
    });
  });
});
