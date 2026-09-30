/**
 * Migration 006 — Backfill `schemaVersion` on Prompt and Review documents.
 *
 * Context
 * -------
 * The server/src/services/schemaVersioning.ts compatibility layer uses
 * `schemaVersion` as a discriminant to apply the correct read-path transform
 * on every document returned by the API.  Records written before this
 * migration was introduced have no `schemaVersion` field at all (treated as
 * version 0 by the transform layer).  This migration stamps the *minimum safe*
 * backfill version on every existing document that lacks the field, so the
 * read path can apply transforms deterministically without relying on the
 * absence heuristic forever.
 *
 * Backfill versions
 * -----------------
 *   • Prompts → schemaVersion 1
 *     (v2 introduces lifecycle fields; old records don't have them, so they
 *     must go through the v1→v2 transform path rather than bypass it)
 *   • Reviews → schemaVersion 1
 *     (v2 guarantees a `status` field; old records default to "published" via
 *     the transform, which is the correct semantic for pre-moderation records)
 *
 * New writes
 * ----------
 * After this migration, any service that creates a Prompt or Review should
 * call `currentPromptSchemaVersion()` / `currentReviewSchemaVersion()` from
 * schemaVersioning.ts to stamp the latest version on insert.
 *
 * Rollback
 * --------
 * The `down` path removes the `schemaVersion` field from all documents in
 * both collections using `$unset`, fully reversing the backfill.
 */

interface MigrationDb {
  collection(name: string): {
    updateMany(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ): Promise<{ modifiedCount: number }>;
  };
}

/** Version to stamp on legacy Prompt documents (see module-level notes). */
const PROMPT_BACKFILL_VERSION = 1;

/** Version to stamp on legacy Review documents. */
const REVIEW_BACKFILL_VERSION = 1;

export async function up(db: MigrationDb): Promise<void> {
  // Prompts: stamp only records that have NO schemaVersion yet.
  const promptResult = await db.collection("prompts").updateMany(
    { schemaVersion: { $exists: false } },
    { $set: { schemaVersion: PROMPT_BACKFILL_VERSION } },
  );
  console.log(
    `[006] Stamped schemaVersion=${PROMPT_BACKFILL_VERSION} on ${promptResult.modifiedCount} Prompt document(s).`,
  );

  // Reviews: same — only unversioned records.
  const reviewResult = await db.collection("reviews").updateMany(
    { schemaVersion: { $exists: false } },
    { $set: { schemaVersion: REVIEW_BACKFILL_VERSION } },
  );
  console.log(
    `[006] Stamped schemaVersion=${REVIEW_BACKFILL_VERSION} on ${reviewResult.modifiedCount} Review document(s).`,
  );
}

export async function down(db: MigrationDb): Promise<void> {
  // Remove the field from all documents in both collections so the
  // database is back to the pre-migration state (absence === v0).
  await db.collection("prompts").updateMany(
    { schemaVersion: { $exists: true } },
    { $unset: { schemaVersion: "" } },
  );
  console.log("[006] Removed schemaVersion from all Prompt documents.");

  await db.collection("reviews").updateMany(
    { schemaVersion: { $exists: true } },
    { $unset: { schemaVersion: "" } },
  );
  console.log("[006] Removed schemaVersion from all Review documents.");
}
