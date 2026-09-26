import connectDb from "../db/connectDb";
import { runContentIntegrityCheckAll } from "../services/contentIntegrity";

async function main() {
  console.log("[integrity-cli] Starting scheduled content integrity check...");
  try {
    await connectDb();
    const report = await runContentIntegrityCheckAll();

    console.log("\n=== Content Integrity Audit Summary ===");
    console.log(`Checked At:        ${report.checkedAt}`);
    console.log(`Total Prompts:     ${report.totalChecked}`);
    console.log(`OK:                ${report.okCount}`);
    console.log(`Corrupted:         ${report.corruptedCount}`);
    console.log(`Missing:           ${report.missingCount}`);
    console.log(`Unreachable:       ${report.unreachableCount}`);

    if (report.failures.length > 0) {
      console.error("\n!!! INTEGRITY FAILURES DETECTED !!!");
      for (const failure of report.failures) {
        console.error(
          `- Prompt [${failure.promptId}]: status=${failure.status} error=${failure.error}`,
        );
      }
      process.exit(1);
    } else {
      console.log("\nAll prompts passed integrity checks successfully.");
      process.exit(0);
    }
  } catch (err) {
    console.error("[integrity-cli] Execution failed:", err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
