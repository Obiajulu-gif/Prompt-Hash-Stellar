/**
 * Disaster Recovery Domain Invariant Validation CLI (Issue #816)
 *
 * Read-only validation script executed after database restore, migration, or failover.
 *
 * Usage:
 *   npx ts-node server/scripts/validateRestoreInvariants.ts [--strict] [--json]
 */

import connectDb from "../src/db/connectDb";
import { disasterRecoveryValidationService } from "../src/services/disasterRecoveryValidation";

async function run() {
  const isJson = process.argv.includes("--json");
  const isStrict = process.argv.includes("--strict");

  try {
    await connectDb();
    const report = await disasterRecoveryValidationService.validateAllInvariants();

    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
      const hasFailure = !report.passed || (isStrict && report.warningViolationsCount > 0);
      process.exit(hasFailure ? 1 : 0);
    }

    console.log("==================================================================");
    console.log("  PROMPT HASH STELLAR - DISASTER RECOVERY INVARIANT VALIDATION");
    console.log(`  Timestamp: ${report.timestamp}`);
    console.log(`  Overall Status: [ ${report.passed ? "PASSED" : "FAILED"} ]`);
    console.log("==================================================================\n");

    console.log("SUMMARY:");
    console.log(`  • Invariants Evaluated:   ${report.totalInvariantsChecked}`);
    console.log(`  • Critical Violations:    ${report.criticalViolationsCount}`);
    console.log(`  • High Violations:        ${report.highViolationsCount}`);
    console.log(`  • Warning Violations:     ${report.warningViolationsCount}`);
    console.log("\n------------------------------------------------------------------");

    for (const check of Object.values(report.summary)) {
      const statusTag = check.passed ? "[ PASS ]" : "[ FAIL ]";
      console.log(`\n${statusTag} ${check.invariantId}: ${check.name}`);
      console.log(`       Scanned: ${check.totalRecordsScanned} records | Violations: ${check.violationCount}`);

      if (!check.passed && check.violations.length > 0) {
        check.violations.forEach((v) => {
          console.log(`       -> [${v.severity}] [${v.entityType} ${v.entityId}]: ${v.message}`);
        });
      }
    }

    console.log("\n==================================================================");

    const hasFailure = !report.passed || (isStrict && report.warningViolationsCount > 0);
    if (hasFailure) {
      console.error("\n[!] Domain invariant validation FAILED. Do not open database to write traffic.");
      process.exit(1);
    } else {
      console.log("\n[✓] All core domain invariants verified. Database is ready for traffic.");
      process.exit(0);
    }
  } catch (err) {
    console.error("Disaster recovery validation crashed:", err);
    process.exit(1);
  }
}

run();
