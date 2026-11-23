#!/usr/bin/env node
/**
 * Release readiness checks — Issue #1047 (scoped slice).
 *
 * Pure, dependency-free checks for the three release gates:
 * migrations, smoke tests, and rollback. Covers normal, failure, retry,
 * and authorization paths.
 *
 * Usage:
 *   node scripts/release-readiness.mjs --self-test [--json]
 *
 * `--self-test` runs five golden cases (normal pass, migration failure,
 * smoke failure, missing rollback, unauthorized rollback) and exits 0/1,
 * mirroring the `--self-test`/`--self-check` pattern used by
 * `scripts/dry-run-migration.py` and `scripts/check-ttl-readiness.mjs`.
 * CI wires it in `.github/workflows/release-readiness.yml`.
 *
 * Recovery: fix the reported failure, re-run this script, then follow
 * docs/RELEASE_READINESS_CHECKLIST.md and docs/OPERATION_RECOVERY.md
 * (retry via operationRecoveryService.userRetry, rollback via
 * `yarn --cwd server db:rollback` or feature-flag disable).
 */

export function checkMigrationPlan(migrations) {
  const failures = [];
  for (const m of migrations ?? []) {
    if (!m.hasDown) failures.push(`${m.name}: missing down() rollback`);
    if (!m.dryRunPassed) failures.push(`${m.name}: dry-run did not pass${m.retryable ? " (retryable)" : ""}`);
  }
  return { pass: failures.length === 0, failures };
}

export function checkSmokeResults(layers) {
  const failures = [];
  for (const [name, result] of Object.entries(layers ?? {})) {
    if (result !== "pass") failures.push(`${name}: ${result}`);
  }
  return { pass: failures.length === 0, failures };
}

export function checkRollbackPlan(plan) {
  const failures = [];
  if (!plan?.strategy) failures.push("no rollback strategy (flag-disable | migration-rollback | revert-tag)");
  if (!plan?.commandDocumented) failures.push("rollback command not documented in PR");
  if (!plan?.tested) failures.push("rollback command not tested");
  return { pass: failures.length === 0, failures };
}

/**
 * Verify captured evidence from a deployment rollback rehearsal.
 *
 * This is intentionally a pure check: it never calls deployment tooling or
 * mutates infrastructure, so it is safe to run in CI and against staging
 * evidence collected by an authorized operator.
 */
export function checkDeploymentRollback(evidence) {
  const failures = [];
  const deployment = evidence?.deployment;
  const rollback = evidence?.rollback;
  const authorization = evidence?.authorization;

  if (!deployment?.previousVersion) failures.push("deployment: missing previous version");
  if (!deployment?.targetVersion) failures.push("deployment: missing target version");
  if (!deployment?.outcome || !["succeeded", "failed"].includes(deployment.outcome)) {
    failures.push("deployment: outcome must be succeeded or failed");
  }
  if (!deployment?.activeVersion) failures.push("deployment: missing observed active version");

  const attempts = rollback?.attempts;
  if (!Number.isInteger(attempts) || attempts < 1) {
    failures.push("rollback: at least one attempt is required");
  } else if (attempts > 3) {
    failures.push("rollback: retry limit exceeded (maximum 3 attempts)");
  }
  if (rollback?.status !== "verified") failures.push("rollback: status is not verified");
  if (rollback?.health !== "pass") failures.push("rollback: post-rollback health check did not pass");

  if (!authorization?.adminScope) failures.push("authorization: missing admin scope");
  if (!authorization?.reason) failures.push("authorization: missing rollback reason");

  if (deployment?.outcome === "failed" && deployment.activeVersion !== deployment.previousVersion) {
    failures.push("deployment: failed release still appears active");
  }
  if (rollback?.status === "verified" && rollback.targetVersion !== deployment?.previousVersion) {
    failures.push("rollback: target is not the previous version");
  }

  return { pass: failures.length === 0, failures };
}

export function evaluateReleaseReadiness({ migrations, smoke, rollback, authorized }) {
  const failures = [];
  if (!authorized?.adminScope) failures.push("authorization: missing admin scope for rollback/resolve");
  if (!authorized?.reason) failures.push("authorization: missing justification reason");
  failures.push(...checkMigrationPlan(migrations).failures);
  failures.push(...checkSmokeResults(smoke).failures);
  failures.push(...checkRollbackPlan(rollback).failures);
  return { ready: failures.length === 0, failures };
}

const GOLDEN = {
  normal: {
    migrations: [{ name: "007_example", hasDown: true, dryRunPassed: true }],
    smoke: { frontend: "pass", api_health: "pass", configuration: "pass", contract_read: "pass", challenge_endpoint: "pass" },
    rollback: { strategy: "migration-rollback", commandDocumented: true, tested: true },
    authorized: { adminScope: true, reason: "release-1047" },
  },
  migrationFailure: {
    migrations: [{ name: "007_example", hasDown: false, dryRunPassed: false, retryable: true }],
    smoke: { frontend: "pass", api_health: "pass", configuration: "pass", contract_read: "pass", challenge_endpoint: "pass" },
    rollback: { strategy: "migration-rollback", commandDocumented: true, tested: true },
    authorized: { adminScope: true, reason: "release-1047" },
  },
  smokeFailure: {
    migrations: [{ name: "007_example", hasDown: true, dryRunPassed: true }],
    smoke: { frontend: "pass", api_health: "fail", configuration: "pass", contract_read: "pass", challenge_endpoint: "pass" },
    rollback: { strategy: "flag-disable", commandDocumented: true, tested: true },
    authorized: { adminScope: true, reason: "release-1047" },
  },
  rollbackMissing: {
    migrations: [{ name: "007_example", hasDown: true, dryRunPassed: true }],
    smoke: { frontend: "pass", api_health: "pass", configuration: "pass", contract_read: "pass", challenge_endpoint: "pass" },
    rollback: { strategy: "", commandDocumented: false, tested: false },
    authorized: { adminScope: true, reason: "release-1047" },
  },
  unauthorized: {
    migrations: [{ name: "007_example", hasDown: true, dryRunPassed: true }],
    smoke: { frontend: "pass", api_health: "pass", configuration: "pass", contract_read: "pass", challenge_endpoint: "pass" },
    rollback: { strategy: "migration-rollback", commandDocumented: true, tested: true },
    authorized: { adminScope: false, reason: "" },
  },
};

export function runSelfTest() {
  const cases = [
    ["normal", true],
    ["migrationFailure", false],
    ["smokeFailure", false],
    ["rollbackMissing", false],
    ["unauthorized", false],
  ];
  const results = cases.map(([name, expectReady]) => {
    const r = evaluateReleaseReadiness(GOLDEN[name]);
    return { name, expectReady, ready: r.ready, failures: r.failures, ok: r.ready === expectReady };
  });
  return { success: results.every((r) => r.ok), results };
}

const isCli = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isCli) {
  const json = process.argv.includes("--json");
  const { success, results } = runSelfTest();
  if (json) console.log(JSON.stringify({ success, results }, null, 2));
  else {
    console.log("Release readiness self-test (issue #1047)");
    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} [${r.name}] ready=${r.ready}${r.failures.length ? ` — ${r.failures.join("; ")}` : ""}`);
    console.log(success ? "SELF-TEST PASSED" : "SELF-TEST FAILED");
  }
  process.exit(success ? 0 : 1);
}
