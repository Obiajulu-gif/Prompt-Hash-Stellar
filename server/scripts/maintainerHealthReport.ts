/**
 * Maintainer Operational Health CLI Tool (Issue #814)
 *
 * Runs operational health aggregation and outputs a clean console diagnostic report.
 *
 * Usage:
 *   npx ts-node server/scripts/maintainerHealthReport.ts [--json]
 */

import connectDb from "../src/db/connectDb";
import { operationalHealthService } from "../src/services/operationalHealthService";

async function run() {
  const isJson = process.argv.includes("--json");

  try {
    await connectDb();
    const report = await operationalHealthService.generateHealthReport();

    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.status === "CRITICAL" ? 2 : report.status === "DEGRADED" ? 1 : 0);
    }

    console.log("==================================================================");
    console.log(`  PROMPT HASH STELLAR - MAINTAINER OPERATIONAL HEALTH REPORT`);
    console.log(`  Generated At: ${report.timestamp}`);
    console.log(`  Overall Status: [ ${report.status} ]`);
    console.log("==================================================================\n");

    console.log("SUMMARY:");
    console.log(`  • Unresolved Exceptions:    ${report.summary.totalUnresolvedExceptions}`);
    console.log(`  • Stale Background Jobs:    ${report.summary.staleJobsCount}`);
    console.log(`  • Reconciliation Drift:     ${report.summary.reconciliationDriftCount} unsettled entries`);
    console.log(`  • Active Support Incidents: ${report.summary.activeIncidentsCount}`);
    console.log("\n------------------------------------------------------------------");

    if (report.categories.unresolvedExceptions.length > 0) {
      console.log("\n[!] UNRESOLVED EXCEPTIONS (Top 10):");
      report.categories.unresolvedExceptions.slice(0, 10).forEach((exc, idx) => {
        console.log(`  ${idx + 1}. [${exc.severity}] [${exc.source}] ${exc.message}`);
        console.log(`     Link: ${exc.investigationLink} | Occurred: ${exc.occurredAt}`);
      });
    }

    if (report.categories.staleJobs.length > 0) {
      console.log("\n[!] STALE JOBS (>15m in-flight):");
      report.categories.staleJobs.forEach((job) => {
        console.log(`  • [${job.type}] ID: ${job.id} (Stuck for ${job.stuckDurationMinutes} mins, status: ${job.status})`);
      });
    }

    if (report.categories.reconciliationDrift.unsettledLedgerEntriesCount > 0) {
      console.log("\n[!] RECONCILIATION DRIFT DETECTED:");
      console.log(`  • Unsettled Ledger Entries: ${report.categories.reconciliationDrift.unsettledLedgerEntriesCount}`);
      console.log(`  • Unsettled Total Volume:   ${report.categories.reconciliationDrift.unsettledAmountSum} XLM`);
    }

    if (report.categories.activeIncidents.length > 0) {
      console.log("\n[!] ACTIVE INCIDENTS & CASES:");
      report.categories.activeIncidents.slice(0, 5).forEach((inc) => {
        console.log(`  • [${inc.priority}] ${inc.title} (Status: ${inc.status})`);
      });
    }

    console.log("\n==================================================================");
    process.exit(report.status === "CRITICAL" ? 2 : report.status === "DEGRADED" ? 1 : 0);
  } catch (err) {
    console.error("Failed to execute operational health scan:", err);
    process.exit(1);
  }
}

run();
