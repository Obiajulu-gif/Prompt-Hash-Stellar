import mongoose from "mongoose";

/**
 * Migration 006 — durable idempotency outcomes for high-risk writes.
 *
 * The compound unique index scopes a caller key to one route, while the
 * request hash stored in each record detects accidental key reuse with a
 * different payload.
 */
export async function up(db: mongoose.mongo.Db): Promise<void> {
  const collection = db.collection("idempotencyrecords");
  await collection.createIndex({ scope: 1, key: 1 }, { unique: true });
  await collection.createIndex({ expiresAt: 1 });
  await collection.createIndex({ status: 1, expiresAt: 1 });
}

export async function down(db: mongoose.mongo.Db): Promise<void> {
  await db.collection("idempotencyrecords").drop().catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes("ns not found")) throw error;
  });
}
