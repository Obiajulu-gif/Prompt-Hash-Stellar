/**
 * Migration 004 — Add moderationStatus fields to Prompt documents
 * (#moderation-queue).
 *
 * Changes:
 *  - Back-fills `moderationStatus: "pending_review"`, `moderationNote: null`,
 *    and `lastModeratedAt: null` on all existing Prompt documents that do not
 *    yet have the field. New documents created after this migration will get
 *    the Mongoose schema default ("pending_review") automatically.
 *
 * Rollback:
 *  - Removes moderationStatus, moderationNote, and lastModeratedAt from all
 *    Prompt documents. Safe to run in isolation; does not affect any other
 *    collection.
 */

import "dotenv/config";
import mongoose from "mongoose";

export async function up(db: mongoose.mongo.Db): Promise<void> {
  const result = await db.collection("prompts").updateMany(
    { moderationStatus: { $exists: false } },
    {
      $set: {
        moderationStatus: "pending_review",
        moderationNote: null,
        lastModeratedAt: null,
      },
    },
  );
  console.log(`[004] Back-filled moderationStatus on ${result.modifiedCount} prompt documents`);
}

export async function down(db: mongoose.mongo.Db): Promise<void> {
  const result = await db.collection("prompts").updateMany(
    {},
    { $unset: { moderationStatus: "", moderationNote: "", lastModeratedAt: "" } },
  );
  console.log(`[004] Rolled back: removed moderation fields from ${result.modifiedCount} prompt documents`);
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  await up(db);
  await mongoose.disconnect();
}

if (typeof require !== "undefined" && require.main === module) {
  run().catch((err) => {
    console.error("[004] Migration failed:", err);
    process.exit(1);
  });
}
