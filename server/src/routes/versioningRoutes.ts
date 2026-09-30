import express from "express";
import {
  GetBuyerVersion,
  GetPromptVersions,
  PostPromptUpdate,
  RecordPurchase,
} from "../controllers/versioningControllers";
import { requireIdempotency } from "../middleware/idempotency";

export const versioningRouter = express.Router();

// Creator posts a new content version.
versioningRouter.post("/update", requireIdempotency, PostPromptUpdate);
// List version history for a prompt (metadata only, no content).
versioningRouter.get("/:promptId/history", GetPromptVersions);
// Record a purchase at the current version index.
versioningRouter.post("/purchase", requireIdempotency, RecordPurchase);
// Get the version a specific buyer purchased (for unlock).
versioningRouter.get("/buyer-version", GetBuyerVersion);
