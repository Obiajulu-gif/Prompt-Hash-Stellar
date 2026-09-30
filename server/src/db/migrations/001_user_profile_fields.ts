import "dotenv/config";
import mongoose from "mongoose";

export async function up(db: mongoose.mongo.Db): Promise<void> {
  const result = await db.collection("users").updateMany(
    {
      $or: [
        { displayName: { $exists: false } },
        { bio: { $exists: false } },
        { avatarUrl: { $exists: false } },
        { socialLinks: { $exists: false } },
      ],
    },
    {
      $set: {
        displayName: "",
        bio: "",
        avatarUrl: "",
        socialLinks: { twitter: "", github: "", website: "" },
      },
    },
  );

  console.log(`[001] Updated ${result.modifiedCount} user documents`);
}

export async function down(db: mongoose.mongo.Db): Promise<void> {
  const result = await db.collection("users").updateMany(
    {},
    {
      $unset: {
        displayName: "",
        bio: "",
        avatarUrl: "",
        socialLinks: "",
      },
    },
  );

  console.log(`[001] Rolled back: unset user profile fields`);
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
    console.error("[001] Migration failed:", err);
    process.exit(1);
  });
}

