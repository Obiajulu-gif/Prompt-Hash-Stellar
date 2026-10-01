/**
 * Data Integrity Monitor CLI Tool (Issue #501)
 *
 * Runs a comprehensive data integrity audit sweep across all stored prompt listings.
 * Detects orphaned, duplicate, stale, and inconsistent records.
 * This is a read-only operation by default - it does not modify any record states.
 *
 * Usage:
 *   npx ts-node server/scripts/dataIntegrityMonitor.ts [--json] [--stale-threshold <days>]
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDb from "../src/db/connectDb.js";
import { runDataIntegrityCheck, generateRemediationGuidance } from "../src/services/dataIntegrityMonitor.js";

async function main(): Promise<void> {
  const isJson = process.argv.includes("--json");
  const staleThresholdIndex = process.argv.findIndex(
    (arg, idx) => arg === "--stale-threshold" && idx + 1 < process.argv.length,
  );
  const staleThreshold = staleThresholdIndex
    ? parseInt(process.argv[staleThresholdIndex + 1], 10)
    : 365; // default: 365 days

  if (isJson && isNaN(staleThreshold)) {
    throw new Error("--stale-threshold requires a numeric value");
  }

  try {
    await connectDb();
    const report = await runDataIntegrityCheck();

    if (isJson) {
      console.log(JSON.stringify(report, null, 2));

      // Exit code based on severity of findings
      const criticalFailures = report.failures.filter(
        (f) => f.severity === "critical",
      ).length;
      if (criticalFailures > 0) {
        process.exit(2);
      }
      const warningFailures = report.failures.filter(
        (f) => f.severity === "warning",
      ).length;
      if (warningFailures > 0 && criticalFailures === 0) {
        process.exit(1);
      }
      process.exit(0);
    }

    // Human-readable console report
    console.log("==================================================================");
    console.log(
      `  PROMPT HASH STELLAR - DATA INTEGRITY AUDIT REPORT`,
    );
    console.log(`  Generated At: ${new Date().toISOString()}`);
    console.log(`  Total Records Checked: ${report.totalRecordsChecked}`);
    console.log(`  Overall Status: [ ${report.totalFailures > 0 ? "ATTENTION NEEDED" : "CLEAN"} ]`);
    console.log("==================================================================\n");

    const categoryCounts = [
      { count: report.orphanedCount, label: "Orphaned Records" },
      { count: report.duplicateCount, label: "Duplicate Records" },
      { count: report.staleCount, label: "Stale Records" },
      { count: report.inconsistentCount, label: "Inconsistent Records" },
    ];

    for (const { count, label } of categoryCounts) {
      console.log(`--- ${label} (${count}) ---`);
      if (count === 0) {
        console.log("  No failures found.");
      } else {
        // Show summary of failures by invariant ID
        const categoryFailures = report.failures.filter((f) => {
          return (
            label === "Orphaned Records"
              ? f.invariantId.startsWith("INV-ORPHAN")
              : label === "Duplicate Records"
              ? f.invariantId.startsWith("INV-DUP")
              : label === "Stale Records"
              ? f.invariantId.startsWith("INV-STALE")
              : f.invariantId.startsWith("INV-INCONS")
          );
        });

        // Group by severity
        const critical = categoryFailures.filter((f) => f.severity === "critical");
        const warning = categoryFailures.filter((f) => f.severity === "warning");
        const info = categoryFailures.filter((f) => f.severity === "info");

        if (critical.length > 0) {
          console.log(`  [CRITICAL] ${critical.length} issue(s)`);
          critical.slice(0, 3).forEach((f) => {
            console.log(`    - ${f.name}: ${f.details.reason}`);
          });
        }
        if (warning.length > 0) {
          console.log(`  [WARNING] ${warning.length} issue(s)`);
          warning.slice(0, 3).forEach((f) => {
            console.log(`    - ${f.name}: ${f.details.reason}`);
          });
        }
        if (info.length > 0) {
          console.log(`  [INFO] ${info.length} issue(s)`);
          info.slice(0, 3).forEach((f) => {
            console.log(`    - ${f.name}: ${f.details.reason}`);
          });
        }
      }
      console.log("");
    }

    // Generate and display remediation guidance
    console.log("--- REMEDIATION GUIDANCE ---");
    const guidance = generateRemediationGuidance(report);
    // Print first portion of guidance
    const guidanceLines = guidance.split("\n");
    // Print summary lines only (first 20 lines)
    console.log(guidanceLines.slice(0, 20).join("\n"));
    console.log(`... (full guidance includes ${guidanceLines.length} lines)`);

    console.log("==================================================================");
    process.exit(report.totalFailures > 0 ? 1 : 0);
  } catch (err) {
    console.error("Failed to execute data integrity monitor:", err);
    process.exit(1);
  }
}

main();