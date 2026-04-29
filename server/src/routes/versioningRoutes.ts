import express from "express";
import {
  GetBuyerVersion,
  GetPromptVersions,
  PostPromptUpdate,
  RecordPurchase,
} from "../controllers/versioningControllers";

export const versioningRouter = express.Router();

// Creator posts a new content version.
versioningRouter.post("/update", PostPromptUpdate);
// List version history for a prompt (metadata only, no content).
versioningRouter.get("/:promptId/history", GetPromptVersions);
// Record a purchase at the current version index.
versioningRouter.post("/purchase", RecordPurchase);
// Get the version a specific buyer purchased (for unlock).
versioningRouter.get("/buyer-version", GetBuyerVersion);
