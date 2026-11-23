import { describe, expect, it } from "vitest";
import {
  checkMigrationPlan,
  checkSmokeResults,
  checkRollbackPlan,
  evaluateReleaseReadiness,
  runSelfTest,
} from "../../scripts/release-readiness.mjs";

const ready = {
  migrations: [{ name: "007_example", hasDown: true, dryRunPassed: true }],
  smoke: { frontend: "pass", api_health: "pass", configuration: "pass", contract_read: "pass", challenge_endpoint: "pass" },
  rollback: { strategy: "migration-rollback", commandDocumented: true, tested: true },
  authorized: { adminScope: true, reason: "release-1047" },
};

describe("release readiness (issue #1047)", () => {
  it("passes the normal path", () => {
    expect(evaluateReleaseReadiness(ready).ready).toBe(true);
  });

  it("fails when a migration has no rollback or dry-run (failure + retry)", () => {
    const r = checkMigrationPlan([{ name: "007_bad", hasDown: false, dryRunPassed: false, retryable: true }]);
    expect(r.pass).toBe(false);
    expect(r.failures.join(" ")).toMatch(/down|dry-run|retryable/);
  });

  it("fails when any smoke layer fails", () => {
    const r = checkSmokeResults({ ...ready.smoke, api_health: "fail" });
    expect(r.pass).toBe(false);
    expect(r.failures.join(" ")).toMatch(/api_health/);
  });

  it("fails when the rollback plan is missing or untested", () => {
    expect(checkRollbackPlan({ strategy: "", commandDocumented: false, tested: false }).pass).toBe(false);
  });

  it("fails on missing authorization scope or reason", () => {
    const r = evaluateReleaseReadiness({ ...ready, authorized: { adminScope: false, reason: "" } });
    expect(r.ready).toBe(false);
    expect(r.failures.join(" ")).toMatch(/authorization/);
  });

  it("keeps the executable golden rollback checks in sync", () => {
    const result = runSelfTest();
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(5);
  });
});
