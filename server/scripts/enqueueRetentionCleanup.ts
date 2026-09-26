import "dotenv/config";
import mongoose from "mongoose";
import connectDb from "../src/db/connectDb.js";
import { enqueueJob } from "../src/jobs/jobQueue";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter((arg) => arg !== "--dry-run");
  if (unknownArgs.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  }
  if (!process.env.MONGODB_URI) {
    throw new Error(
      "MONGODB_URI must be set before enqueueing retention cleanup",
    );
  }

  await connectDb();
  try {
    const job = await enqueueJob(
      "retention_cleanup",
      { version: 1, dryRun: args.includes("--dry-run") },
      {
        dedupeKey: "retention_cleanup:daily",
        dedupeWindowMs: 24 * 60 * 60 * 1000,
      },
    );
    console.info("[retention-enqueue] job queued", {
      jobId: job.id,
      status: job.status,
      dryRun: args.includes("--dry-run"),
    });
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[retention-enqueue] failed", error);
  process.exitCode = 1;
});
