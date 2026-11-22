import express, { Request, Response } from "express";
import mongoose from "mongoose";
import connectDb from "../db/connectDb";
import { requireAdminScope, type AdminRequest } from "../middleware/adminAuth";
import Prompt from "../models/Prompt";
import Purchase from "../models/Purchase";
import { recordAuditEvent } from "../services/auditTrail";
import {
  RecordMergeError,
  committedRedirectLookup,
  executeRecordMerge,
  planRecordMerge,
  resolveMergedRecordId,
  type MergeableRecord,
  type RecordMergeAdapter,
} from "../services/recordMerge";

/**
 * Duplicate prompt merge (#902). Mounted at /api/admin/record-merges.
 *
 *   POST /plan                 dry run; writes nothing          record_merge:read
 *   POST /execute              apply a plan with its planHash   record_merge:write
 *   GET  /resolve/:promptId    follow merged redirects          record_merge:read
 */
export const recordMergeRouter = express.Router();

async function loadPromptRecord(id: string): Promise<MergeableRecord | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const prompt = await Prompt.findById(id).lean();
  if (!prompt) return null;

  const promptId = String(prompt._id);
  const [activeLicenseCount, mergedInto] = await Promise.all([
    Purchase.countDocuments({ promptId }),
    committedRedirectLookup(promptId),
  ]);

  return {
    id: promptId,
    ownerId: String(prompt.owner),
    isActive: Boolean(prompt.isActive),
    mergedInto,
    onChainId: prompt.onChainId ?? null,
    activeLicenseCount,
    fields: {
      title: prompt.title,
      description: prompt.description,
      tags: prompt.tags,
      price: prompt.price,
    },
  };
}

const promptAdapter: RecordMergeAdapter = {
  loadRecord: loadPromptRecord,
  async applyMerge({ sourceId, targetId, mergedFields }) {
    await Prompt.updateOne({ _id: targetId }, { $set: mergedFields });
    await Prompt.updateOne({ _id: sourceId }, { $set: { isActive: false } });
  },
};

function readIds(req: Request): { sourceId: string; targetId: string } | null {
  const { sourceId, targetId } = req.body ?? {};
  if (typeof sourceId !== "string" || typeof targetId !== "string" || !sourceId || !targetId) {
    return null;
  }
  return { sourceId, targetId };
}

recordMergeRouter.post(
  "/plan",
  requireAdminScope("record_merge:read"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const ids = readIds(req);
      if (!ids) {
        return res.status(400).json({ error: "sourceId and targetId are required." });
      }
      const [source, target] = await Promise.all([
        loadPromptRecord(ids.sourceId),
        loadPromptRecord(ids.targetId),
      ]);
      if (!source || !target) {
        return res.status(404).json({ error: "Source or target record was not found." });
      }
      return res.json({ success: true, plan: planRecordMerge(source, target) });
    } catch (err) {
      console.error("Record merge plan error:", err);
      return res.status(500).json({ error: "Failed to plan record merge." });
    }
  },
);

recordMergeRouter.post(
  "/execute",
  requireAdminScope("record_merge:write"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const ids = readIds(req);
      const { planHash, resolutions } = req.body ?? {};
      if (!ids || typeof planHash !== "string" || !planHash) {
        return res.status(400).json({ error: "sourceId, targetId, and planHash are required." });
      }
      const admin = (req as AdminRequest).admin;

      const result = await executeRecordMerge(promptAdapter, {
        ...ids,
        expectedPlanHash: planHash,
        resolutions: resolutions && typeof resolutions === "object" ? resolutions : {},
        actor: admin?.sub ?? "",
        requestId: req.correlationId ?? null,
      });

      await recordAuditEvent({
        action: "record_merge_committed",
        result: "success",
        promptId: ids.targetId,
        actor: admin?.sub ?? null,
        target: ids.sourceId,
        targetType: "prompt",
        requestId: req.correlationId ?? null,
        reason: `mergeId=${result.mergeId} source=${ids.sourceId} target=${ids.targetId}`,
      });

      return res.status(201).json({
        success: true,
        mergeId: result.mergeId,
        status: result.status,
        mergedFields: result.mergedFields,
      });
    } catch (err) {
      if (err instanceof RecordMergeError) {
        const status =
          err.code === "stale_plan" ? 409 : err.code === "not_found" ? 404 : 400;
        return res.status(status).json({ error: err.message, code: err.code });
      }
      console.error("Record merge execute error:", err);
      return res.status(500).json({ error: "Failed to execute record merge." });
    }
  },
);

recordMergeRouter.get(
  "/resolve/:promptId",
  requireAdminScope("record_merge:read"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const resolved = await resolveMergedRecordId(String(req.params.promptId), committedRedirectLookup);
      return res.json({ success: true, requestedId: String(req.params.promptId), ...resolved });
    } catch (err) {
      if (err instanceof RecordMergeError) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      console.error("Record merge resolve error:", err);
      return res.status(500).json({ error: "Failed to resolve merged record." });
    }
  },
);
