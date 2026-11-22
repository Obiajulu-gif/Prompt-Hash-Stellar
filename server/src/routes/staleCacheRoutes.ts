import express from "express";
import { detectStaleCache, buildPromptSourceVersions } from "../services/staleCacheService";
import { requireAdminScope } from "../middleware/adminAuth";

export const staleCacheRouter = express.Router();

/**
 * GET /api/stale-cache/detect
 * Detect stale cache entries for provided source versions.
 * Query format: ?key=prompts:detail:abc&version=123&key=prompts:metadata:abc&version=123
 */
staleCacheRouter.get(
  "/detect",
  requireAdminScope("health:read"),
  async (req, res) => {
    try {
      const keys = req.query.key as string | string[] | undefined;
      const versions = req.query.version as string | string[] | undefined;

      const keyList = Array.isArray(keys) ? keys : keys ? [String(keys)] : [];
      const versionList = Array.isArray(versions) ? versions : versions ? [String(versions)] : [];

      const sourceVersions: Record<string, string | number> = {};
      for (let i = 0; i < keyList.length; i++) {
        sourceVersions[keyList[i]] = versionList[i] ?? "1";
      }

      const report = await detectStaleCache(sourceVersions);
      res.json({ success: true, report });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to detect stale cache" });
    }
  }
);

/**
 * GET /api/stale-cache/detect/:promptId
 * Detect stale cache entries for a specific prompt listing.
 */
staleCacheRouter.get(
  "/detect/:promptId",
  requireAdminScope("health:read"),
  async (req, res) => {
    try {
      const { promptId } = req.params as { promptId: string };
      const version = String(req.query.version ?? "1");
      const sourceVersions = buildPromptSourceVersions(promptId, version);
      const report = await detectStaleCache(sourceVersions);
      res.json({ success: true, promptId, report });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to detect stale cache" });
    }
  }
);