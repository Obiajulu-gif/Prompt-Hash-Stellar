/**
 * Optimistic concurrency controller — version-aware updates (#840).
 *
 * Provides a generic endpoint for updating records with version checks.
 * Concurrent edits that supply a stale version are rejected with a clear
 * conflict message and the latest version so the client can retry.
 */

import { Request, Response } from "express";
import { updateWithVersionCheck } from "../models/VersionedRecord";
import mongoose from "mongoose";
import { logger } from "../services/structuredLogger";

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

    // Validate collection name against allowlist
    const allowedCollections = ["prompts", "users", "invitations"];
    if (!allowedCollections.includes(collection)) {
      return res.status(400).json({ error: "Invalid collection" });
    }

    const Model = mongoose.model(collection);
    if (!Model) {
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
        message:
          "Please refresh and retry with the latest version.",
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
