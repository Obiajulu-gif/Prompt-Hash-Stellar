import mongoose from "mongoose";
import { backfillProvenanceFromSimilarity } from "../../services/provenance";

/**
 * Prompt provenance graph (#753): create the relation indexes and backfill
 * unconfirmed `source` relations for legacy listings that similarity
 * detection already linked to an earlier listing. Creators can confirm or
 * remove them; moderators see them as unconfirmed attributions.
 */
export async function up(db: mongoose.mongo.Db): Promise<void> {
  const { created, skipped } = await backfillProvenanceFromSimilarity(db);
  console.log(`[003] Backfilled ${created} provenance relations (${skipped} skipped)`);
}

export async function down(db: mongoose.mongo.Db): Promise<void> {
  // Only remove what the backfill created; creator-declared relations stay.
  const result = await db.collection("promptrelations").deleteMany({ origin: "backfill" });
  console.log(`[003] Rolled back: removed ${result.deletedCount} backfilled provenance relations`);
}
