import express from "express";
import { ImproveProxy } from "../controllers/controllers";
import { enforcePolicyLimit } from "../middleware/policyLimitMiddleware";

export const proxyrouter = express.Router();

proxyrouter.route("/").post(enforcePolicyLimit("COMPUTE_AI_IMPROVE"), ImproveProxy);
