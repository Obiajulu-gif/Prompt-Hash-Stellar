/**
 * Activity Timeline routes — privacy-aware event filtering (#838).
 */

import express from "express";
import {
  GetTimeline,
  GetResourceTimeline,
} from "../controllers/timelineControllers";

export const timelineRouter = express.Router();

// User timeline (privacy-filtered)
timelineRouter.get("/:walletAddress", GetTimeline);

// Resource timeline (e.g., events for a specific prompt)
timelineRouter.get("/:resourceType/:resourceId", GetResourceTimeline);
