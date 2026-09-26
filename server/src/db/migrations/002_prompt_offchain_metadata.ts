import "dotenv/config";
import mongoose from "mongoose";

export async function up(db: mongoose.mongo.Db): Promise<void> {
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
}

export async function down(db: mongoose.mongo.Db): Promise<void> {
  const result = await db.collection("prompts").updateMany(
    {},
    {
      $unset: {
        description: "",
        tags: "",
        onChainReference: "",
      },
    },
  );

  console.log(`[002] Rolled back: unset prompt off-chain metadata fields`);
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
    console.error("[002] Migration failed:", err);
    process.exit(1);
  });
}

