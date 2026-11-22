import assert from "node:assert/strict";
import {
  checkMigrationPlan,
  checkRollbackPlan,
  checkSmokeResults,
  evaluateReleaseReadiness,
} from "./release-readiness.mjs";

const passing = {
  migrations: [{ name: "001_example", hasDown: true, dryRunPassed: true }],
  smoke: { api: "pass", frontend: "pass" },
  rollback: {
    strategy: "migration-rollback",
    commandDocumented: true,
    tested: true,
  },
  authorized: { adminScope: true, reason: "release-1125" },
};

assert.deepEqual(checkMigrationPlan(passing.migrations), {
  pass: true,
  failures: [],
});
assert.deepEqual(checkSmokeResults(passing.smoke), { pass: true, failures: [] });
assert.deepEqual(checkRollbackPlan(passing.rollback), {
  pass: true,
  failures: [],
});
assert.equal(evaluateReleaseReadiness(passing).ready, true);

const migrationFailure = evaluateReleaseReadiness({
  ...passing,
  migrations: [{ name: "002_irreversible", hasDown: false, dryRunPassed: false }],
});
assert.equal(migrationFailure.ready, false);
assert.match(migrationFailure.failures.join("\n"), /missing down\(\) rollback/);
assert.match(migrationFailure.failures.join("\n"), /dry-run did not pass/);

const unauthorized = evaluateReleaseReadiness({
  ...passing,
  authorized: { adminScope: false, reason: "" },
});
assert.equal(unauthorized.ready, false);
assert.deepEqual(unauthorized.failures.slice(0, 2), [
  "authorization: missing admin scope for rollback/resolve",
  "authorization: missing justification reason",
]);

console.log("release-readiness #1125 checks passed");
