/**
 * Migration 002 — Add off-chain metadata fields to Prompt documents (#333)
 *
 * Run once:  npx ts-node server/src/db/migrations/002_prompt_offchain_metadata.ts
 *
 * What it does:
 *   - Adds description, tags, onChainReference with defaults to all existing
 *     Prompt documents that don't already have these fields.
 */

import "dotenv/config";
import mongoose from "mongoose";

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;

  const result = await db.collection("prompts").updateMany(
    {
      $or: [
        { description: { $exists: false } },
        { tags: { $exists: false } },
        { onChainReference: { $exists: false } },
      ],
    },
    {
      $set: {
        description: "",
        tags: [],
        onChainReference: "",
      },
    },
  );

  console.log(`[002] Updated ${result.modifiedCount} prompt documents`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("[002] Migration failed:", err);
  process.exit(1);
});
