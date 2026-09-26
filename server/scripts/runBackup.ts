/**
 * Standalone backup runner — invoked by cron or CI schedule.
 *
 * Usage:
 *   ts-node server/scripts/runBackup.ts
 *
 * Required environment variables:
 *   MONGODB_URI, BACKUP_S3_BUCKET
 *
 * Optional:
 *   BACKUP_S3_PREFIX, BACKUP_S3_REGION, BACKUP_ALERT_WEBHOOK
 *
 * Cron example (daily at 02:00 UTC):
 *   0 2 * * * cd /app && ts-node server/scripts/runBackup.ts >> /var/log/prompthash-backup.log 2>&1
 */

import mongoose from "mongoose";
import { runBackup } from "../src/services/backupService";

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log(`[backup] Connected to MongoDB at ${new Date().toISOString()}`);

  try {
    await runBackup();
    console.log("[backup] Done.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("[backup] Fatal:", err);
  process.exit(1);
});
