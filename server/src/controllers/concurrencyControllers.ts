/**
 * Optimistic concurrency controller — version-aware updates (#840).
 *
 * Provides a generic endpoint for updating records with version checks.
 * Concurrent edits that supply a stale version are rejected with a clear
 * conflict message and the latest version so the client can retry.
 *
 * Duplicate-submission concurrency coverage:
 * - Normal path: a matching expectedVersion applies the update and returns success.
 * - Failure path: missing/invalid fields, disallowed collections, and unknown
 * models are rejected before any database write occurs.
 * - Retry path: a stale expectedVersion returns 409 with currentVersion so the
 * client can refetch and resubmit. A duplicate submission of an already-applied
 * update therefore fails safely with 409 rather than being applied twice.
 * - Authorization path: the collection allowlist is enforced here; callers must
 * be authenticated upstream by the router middleware.
 *
 * Edge cases and recovery:
 * - expectedVersion must be a non-negative integer; anything else is rejected with
 * 400 to avoid ambiguous comparisons (e.g. strings coerced by Mongo).
 * - If the record disappears between the conditional update and the follow-up
 * lookup, currentVersion is reported as -1 and the client should treat the
 * record as gone.
 * - No writes are performed on rejected requests, so there is nothing to roll
 * back. The conditional update in updateWithVersionCheck is atomic, which
 * prevents two concurrent duplicate submissions from both succeeding.
 * - Concurrency coverage for the duplicate-submission race is exercised by the
 * controller test suite (normal, failure, retry, and authorization paths).
 */

import { Request, Response } from "express";
import { updateWithVersionCheck } from "../models/VersionedRecord";
import mongoose from "mongoose";
import { logger } from "../services/structuredLogger";

const ALLOWED_COLLECTIONS = ["prompts", "users", "invitations"] as const;

const isValidExpectedVersion = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export const UpdateWithVersionCheck = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    const { collection, recordId, update, expectedVersion } = req.body;

    if (!collection || !recordId || !update || expectedVersion === undefined) {
      return res.status(400).json({
        error:
          "Missing required fields: collection, recordId, update, expectedVersion",
      });
    }

    if (!isValidExpectedVersion(expectedVersion)) {
      return res.status(400).json({
        error: "expectedVersion must be a non-negative integer",
      });
    }

    // Validate collection name against allowlist
    if (!(ALLOWED_COLLECTIONS as readonly string[]).includes(collection)) {
      return res.status(400).json({ error: "Invalid collection" });
    }

    if (!mongoose.isValidObjectId(recordId)) {
      return res.status(400).json({ error: "Invalid recordId" });
    }

    let Model: mongoose.Model<any>;
    try {
      Model = mongoose.model(collection);
    } catch {
      return res.status(400).json({ error: `Unknown collection: ${collection}` });
    }

    const { matched, modified } = await updateWithVersionCheck(
      Model,
      { _id: recordId },
      update,
      expectedVersion,
    );

    if (!matched) {
      // Fetch current version for the client
      const current = await Model.findById(recordId).select("version");
      const currentVersion = current?.version ?? -1;

      logger.warn("Stale write detected", {
        action: "updateWithVersionCheck",
        collection,
        recordId,
        expectedVersion,
        currentVersion,
      });

      return res.status(409).json({
        error: "Conflict: record has been modified by another session",
        currentVersion,
        message: "Please refresh and retry with the latest version.",
      });
    }

    return res.json({ success: true, modified });
  } catch (err) {
    logger.error("Version check update error", {
      action: "updateWithVersionCheck",
      error: err,
    });
    return res.status(500).json({
      error: (err as Error).message || "Failed to update record",
    });
  }
};
