/**
 * Optimistic concurrency helper — adds version tokens to records (#840).
 *
 * Provides a Mongoose middleware and static method for stale-write detection.
 * Any record that mixes in `optimisticConcurrencyPlugin` gains a `version`
 * field; updates must supply the current version or the update is rejected.
 */

import mongoose from "mongoose";

export interface OptimisticRecord {
  version: number;
}

const versionField = {
  version: {
    type: Number,
    default: 1,
    min: 0,
  },
};

function optimisticConcurrencyPlugin(schema: mongoose.Schema) {
  schema.add(versionField);

  // Increment version on save
  schema.pre("save", function (this: any) {
    if (this.isModified() && !this.isNew) {
      this.version = (this.version || 0) + 1;
    }
  });
}

async function updateWithVersionCheck(
  model: mongoose.Model<any>,
  filter: Record<string, any>,
  update: Record<string, any>,
  expectedVersion: number,
): Promise<{ matched: boolean; modified: boolean }> {
  const result = await model.updateOne(
    { ...filter, version: expectedVersion },
    { $set: update, $inc: { version: 1 } },
  );

  return {
    matched: result.matchedCount > 0,
    modified: result.modifiedCount > 0,
  };
}

export { optimisticConcurrencyPlugin, updateWithVersionCheck, versionField };
