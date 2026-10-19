/**
 * Concrete backfill jobs for the operator backfill tool (#966).
 */

import { canonicalJson } from "./canonicalSerialization";
import { CURRENT_PROMPT_SCHEMA_VERSION, transformPromptForApi } from "./schemaVersioning";
import type { BackfillJob } from "./backfillEngine";

/**
 * Fields the prompt read path fills in for records below the current schema
 * version. Persisting them is what makes reads identical after the backfill,
 * so the read-path transform no longer has to do this work on every request.
 */
export const PROMPT_FILL_KEYS = [
  "schemaVersion",
  "lifecycleState",
  "moderationStatus",
  "tags",
  "description",
  "licence",
  "category",
  "listingStatus",
] as const;

/** The subset of a Mongoose model the job needs. Kept narrow so tests can fake it. */
export interface PromptCollection {
  find(filter: Record<string, unknown>): any;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
}

/**
 * Persists the read-path fills for prompts stored below the current schema
 * version. Dry runs show the exact `$set` that would be written.
 *
 * Idempotent: once a record matches the read path, `plan` returns skip, so a
 * replayed batch changes nothing.
 */
export function promptReadFillsJob(collection: PromptCollection): BackfillJob {
  return {
    name: "prompt-read-fills",

    async fetchPage(after, limit) {
      const filter: Record<string, unknown> = {
        $or: [
          { schemaVersion: { $exists: false } },
          { schemaVersion: { $lt: CURRENT_PROMPT_SCHEMA_VERSION } },
        ],
      };
      if (after) filter._id = { $gt: after };
      const docs: Array<Record<string, unknown>> = await collection
        .find(filter)
        .sort({ _id: 1 })
        .limit(limit)
        .lean();
      return docs.map((doc) => ({ id: String(doc._id), data: doc }));
    },

    plan(record) {
      // Throws SchemaVersionError for records from a newer build; the engine
      // records that as a failure for this record and keeps going.
      const transformed = transformPromptForApi(record.data) as Record<string, unknown>;
      const changes: Record<string, unknown> = {};
      for (const key of PROMPT_FILL_KEYS) {
        const next = transformed[key];
        if (canonicalJson(record.data[key]) !== canonicalJson(next)) {
          changes[key] = next;
        }
      }
      if (Object.keys(changes).length === 0) {
        return { kind: "skip", reason: "already matches the read path" };
      }
      return { kind: "update", changes };
    },

    async apply(record, changes) {
      await collection.updateOne({ _id: record.data._id ?? record.id }, { $set: changes });
    },
  };
}
