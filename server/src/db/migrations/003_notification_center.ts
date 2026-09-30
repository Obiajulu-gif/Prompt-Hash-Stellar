/**
 * Migration 003 — Notification center schema upgrade (#notification-center).
 *
 * Changes:
 *  1. Back-fills `type` default ("prompt_update") and `deepLink` (null) on
 *     existing Notification documents that pre-date this migration so the
 *     expanded schema is consistent across the collection.
 *  2. Creates the `notificationpreferences` collection (no-op if it already
 *     exists) with its unique index on walletAddress.
 *
 * The 90-day TTL index on Notification.createdAt is defined in the Mongoose
 * schema and created by the Mongoose connection, not here, because TTL index
 * management on existing collections is safest via the model definition.
 */

import "dotenv/config";
import mongoose from "mongoose";

export async function up(db: mongoose.mongo.Db): Promise<void> {
  // 1. Back-fill existing Notification documents missing the new fields.
  const notifResult = await db.collection("notifications").updateMany(
    {
      $or: [
        { type: { $exists: false } },
        { deepLink: { $exists: false } },
        { idempotencyKey: { $exists: false } },
      ],
    },
    {
      $set: {
        deepLink: null,
      },
      $setOnInsert: {
        type: "prompt_update",
      },
    },
  );
  console.log(`[003] Back-filled ${notifResult.modifiedCount} notification documents`);

  // 2. Ensure notificationpreferences collection exists with its unique index.
  const collections = await db
    .listCollections({ name: "notificationpreferences" })
    .toArray();
  if (collections.length === 0) {
    await db.createCollection("notificationpreferences");
    console.log("[003] Created notificationpreferences collection");
  }

  await db
    .collection("notificationpreferences")
    .createIndex({ walletAddress: 1 }, { unique: true, background: true });

  console.log("[003] Migration complete");
}

export async function down(db: mongoose.mongo.Db): Promise<void> {
  // Remove the deepLink field added to notifications (idempotencyKey and type
  // were already present or are harmless to leave).
  const result = await db.collection("notifications").updateMany(
    { deepLink: { $exists: true } },
    { $unset: { deepLink: "" } },
  );
  console.log(`[003] Rolled back deepLink from ${result.modifiedCount} notification documents`);

  // Drop the preferences collection — only safe in rollback scenarios.
  await db.collection("notificationpreferences").drop().catch(() => {
    // Ignore "namespace not found" error if collection was never created.
  });
  console.log("[003] Dropped notificationpreferences collection");
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
    console.error("[003] Migration failed:", err);
    process.exit(1);
  });
}
