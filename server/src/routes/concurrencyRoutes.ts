/**
 * Optimistic concurrency routes — version-aware updates (#840).
 */

import express from "express";
import { UpdateWithVersionCheck } from "../controllers/concurrencyControllers";

export const concurrencyRouter = express.Router();

// Version-checked update
concurrencyRouter.post("/update", UpdateWithVersionCheck);
