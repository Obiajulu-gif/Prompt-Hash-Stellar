/**
 * Deduplication observability routes (#1223).
 *
 * Admin-only. There is no mutation endpoint: a conflict is resolved by fixing
 * the producer and replaying from the existing dead-letter/retry tooling, so a
 * "clear dedupe record" API would weaken the guarantee.
 */

import express from "express";
import {
  GetDeduplicationStatus,
  GetDeduplicationSummary,
} from "../controllers/deduplicationControllers";
import { requireAdminScope } from "../middleware/adminAuth";

export const deduplicationRouter = express.Router();

deduplicationRouter.get(
  "/summary",
  requireAdminScope("deduplication:read"),
  GetDeduplicationSummary,
);
deduplicationRouter.get(
  "/:kind/:key",
  requireAdminScope("deduplication:read"),
  GetDeduplicationStatus,
);
