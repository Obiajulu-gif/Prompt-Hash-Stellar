import "dotenv/config";
import mongoose from "mongoose";

/**
 * Migration 003 (#759) — versioned prompt licensing.
 *
 * Backfills the license fields introduced by #759:
 *  - every legacy purchase gets `licenseVersionIndex: 1` (its terms were the
 *    marketplace default at purchase time),
 *  - `licenseSnapshotId` is left null; receipts for these purchases report
 *    `legacy: true` and render the default terms,
 *  - prompts without an explicit license get `licenseVersionIndex: 1`.
 *
 * Idempotent: re-running only touches documents still missing the fields.
 */
export async function up(db: mongoose.mongo.Db): Promise<void> {
  const purchases = await db.collection("purchases").updateMany(
    { licenseVersionIndex: { $exists: false } },
    {
      $set: {
        licenseVersionIndex: 1,
        licenseSnapshotId: null,
      },
    },
  );

  const prompts = await db.collection("prompts").updateMany(
    { licenseVersionIndex: { $exists: false } },
    {
      $set: {
        licenseVersionIndex: 1,
        licenseSummary: "",
        licenseTermsText: "",
        licenseAllowedUses: [],
        licenseCommercialUse: false,
        licenseAttributionRequired: false,
        licenseRedistributionAllowed: false,
        licenseCustomTerms: "",
        licenseTemplateKey: null,
        licenseTemplateVersion: null,
        licenseUpdatedAt: null,
      },
    },
  );

  console.log(
    `[003] Backfilled ${purchases.modifiedCount} purchases and ${prompts.modifiedCount} prompts with license version fields`,
  );
}

export async function down(db: mongoose.mongo.Db): Promise<void> {
  await db.collection("purchases").updateMany(
    { licenseVersionIndex: 1, licenseSnapshotId: null },
    {
      $unset: {
        licenseVersionIndex: "",
        licenseSnapshotId: "",
      },
    },
  );
  await db.collection("prompts").updateMany(
    { licenseVersionIndex: 1, licenseTermsText: "" },
    {
      $unset: {
        licenseVersionIndex: "",
        licenseSummary: "",
        licenseTermsText: "",
        licenseAllowedUses: "",
        licenseCommercialUse: "",
        licenseAttributionRequired: "",
        licenseRedistributionAllowed: "",
        licenseCustomTerms: "",
        licenseTemplateKey: "",
        licenseTemplateVersion: "",
        licenseUpdatedAt: "",
      },
    },
  );

  console.log("[003] Rolled back: unset license version fields");
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
