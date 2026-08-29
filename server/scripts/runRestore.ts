/**
 * Standalone restore runner with integrity verification and dry-run mode (Issue #607)
 *
 * Usage:
 *   # Dry-run mode (verify backup integrity without writing DB):
 *   ts-node server/scripts/runRestore.ts --timestamp 2026-08-24T18-00-00-000Z --dry-run
 *
 *   # Live restore mode (requires --confirm safety flag):
 *   ts-node server/scripts/runRestore.ts --timestamp 2026-08-24T18-00-00-000Z --confirm
 *
 *   # Local directory restore:
 *   ts-node server/scripts/runRestore.ts --local-dir /tmp/backups --timestamp 2026-08-24T18-00-00-000Z --dry-run
 */

import mongoose from "mongoose";
import { restoreBackup } from "../src/services/backupService";

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isConfirm = args.includes("--confirm");

  const timestampIdx = args.indexOf("--timestamp");
  const timestamp = timestampIdx !== -1 ? args[timestampIdx + 1] : undefined;

  const localDirIdx = args.indexOf("--local-dir");
  const localDir = localDirIdx !== -1 ? args[localDirIdx + 1] : undefined;

  if (!timestamp && !localDir) {
    console.error(
      "Usage: ts-node server/scripts/runRestore.ts --timestamp <TIMESTAMP> [--dry-run] [--confirm] [--local-dir <DIR>]",
    );
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log(`[restore] Connected to MongoDB at ${new Date().toISOString()}`);

  try {
    const result = await restoreBackup({
      timestamp,
      localDir,
      dryRun: isDryRun,
      confirm: isConfirm,
    });
    console.log("[restore] Result:", JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("[restore] Fatal:", err);
  process.exit(1);
});
