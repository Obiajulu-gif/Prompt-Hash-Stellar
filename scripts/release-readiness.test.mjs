import test from "node:test";
import assert from "node:assert/strict";

import { checkDeploymentRollback } from "./release-readiness.mjs";

const evidence = {
  deployment: {
    previousVersion: "2026.11.20",
    targetVersion: "2026.11.21",
    outcome: "failed",
    activeVersion: "2026.11.20",
  },
  rollback: {
    targetVersion: "2026.11.20",
    attempts: 2,
    status: "verified",
    health: "pass",
  },
  authorization: { adminScope: true, reason: "rehearsal-1187" },
};

test("deployment rollback evidence passes after a retry", () => {
  assert.deepEqual(checkDeploymentRollback(evidence), { pass: true, failures: [] });
});

test("failed deployments must leave the previous version active", () => {
  const result = checkDeploymentRollback({
    ...evidence,
    deployment: { ...evidence.deployment, activeVersion: evidence.deployment.targetVersion },
  });

  assert.equal(result.pass, false);
  assert.ok(result.failures.includes("deployment: failed release still appears active"));
});

test("rollback verification requires authorization and post-rollback health", () => {
  const result = checkDeploymentRollback({
    ...evidence,
    rollback: { ...evidence.rollback, health: "fail" },
    authorization: { adminScope: false, reason: "" },
  });

  assert.equal(result.pass, false);
  assert.ok(result.failures.includes("rollback: post-rollback health check did not pass"));
  assert.ok(result.failures.includes("authorization: missing admin scope"));
  assert.ok(result.failures.includes("authorization: missing rollback reason"));
});
