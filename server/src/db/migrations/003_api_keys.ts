import mongoose from "mongoose";

export async function up(db: mongoose.mongo.Db): Promise<void> {
  const collection = db.collection("apikeys");
  await collection.createIndex({ keyId: 1 }, { unique: true });
  await collection.createIndex({ keyHash: 1 }, { unique: true });
  await collection.createIndex({ walletAddress: 1, createdAt: -1 });
  await collection.createIndex({ revokedAt: 1, expiresAt: 1 });
}

export async function down(db: mongoose.mongo.Db): Promise<void> {
  await db.collection("apikeys").drop().catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes("ns not found")) throw error;
  });
}