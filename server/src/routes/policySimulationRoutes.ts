/**
 * Policy Simulation Routes (#1182).
 *
 * Mounts endpoints for previewing policy simulations and verifying confirmation tokens.
 * All management endpoints are protected by admin authorization middleware.
 */

import express from "express";
import {
  PreviewPolicySimulation,
  VerifyConfirmationToken,
} from "../controllers/policySimulationControllers.ts";
import { requireAdminScope } from "../middleware/adminAuth.ts";

export const policySimulationRouter = express.Router();

policySimulationRouter.post(
  "/preview",
  requireAdminScope("policy:evaluate"),
  PreviewPolicySimulation,
);

policySimulationRouter.post(
  "/verify-token",
  requireAdminScope("policy:evaluate"),
  VerifyConfirmationToken,
);
