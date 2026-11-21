/**
 * Policy Simulation HTTP Controllers (#1182).
 *
 * Exposes endpoints for safe dry-run simulation of governance, pricing,
 * and operational policies with affected-record previews and HMAC confirmation.
 */

import type { Response } from "express";
import type { AdminRequest } from "../middleware/adminAuth";
import {
  simulatePolicyChange,
  verifySimulationConfirmationToken,
  PolicyEvaluationError,
  type PolicyChange,
  type PolicyEvaluatorActor,
  type SimulationResult,
} from "../services/policySimulation.ts";

function resolveActor(req: AdminRequest, bodyActor?: any): PolicyEvaluatorActor {
  if (bodyActor && Array.isArray(bodyActor.permissions)) {
    return {
      id: String(bodyActor.id || req.admin?.sub || "admin-operator"),
      role: String(bodyActor.role || req.admin?.role || "admin"),
      permissions: new Set(bodyActor.permissions.map(String)),
    };
  }

  const permissions = new Set<string>();
  if (req.admin?.role === "admin") {
    permissions.add("admin");
    permissions.add("policy:evaluate");
  }
  if (Array.isArray(req.admin?.scopes)) {
    for (const scope of req.admin.scopes) {
      permissions.add(scope);
    }
  }
  if (permissions.size === 0) {
    permissions.add("policy:evaluate");
  }

  return {
    id: req.admin?.sub || "admin-operator",
    role: req.admin?.role || "admin",
    permissions,
  };
}

/**
 * POST /api/admin/policy-simulation/preview
 * Body: { policyChange: PolicyChange, candidateRecords?: Record<string, unknown>[] }
 *   or: { type, parameters, reason, candidateRecords?: Record<string, unknown>[] }
 */
export async function PreviewPolicySimulation(
  req: AdminRequest,
  res: Response,
): Promise<Response> {
  const body = (req.body ?? {}) as Record<string, any>;

  let policyChange: PolicyChange;
  if (body.policyChange && typeof body.policyChange === "object") {
    policyChange = body.policyChange;
  } else {
    policyChange = {
      type: body.type,
      parameters: body.parameters ?? {},
      reason: body.reason ?? "Policy simulation preview",
      scheduledBy: body.scheduledBy || req.admin?.sub || "admin-operator",
      targetResource: body.targetResource,
      id: body.id,
    };
  }

  if (!policyChange.type) {
    return res.status(400).json({
      error: "Missing required policy type in request payload.",
      code: "invalid_policy",
    });
  }

  const actor = resolveActor(req, body.actor);
  const candidateRecords = Array.isArray(body.candidateRecords)
    ? body.candidateRecords
    : undefined;

  try {
    const result = await simulatePolicyChange(policyChange, {
      actor,
      candidateRecords,
      maxRecords: body.maxRecords ? Number(body.maxRecords) : undefined,
      maxPreview: body.maxPreview ? Number(body.maxPreview) : undefined,
    });

    return res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof PolicyEvaluationError) {
      switch (err.code) {
        case "unauthorized":
          return res.status(403).json({ error: err.message, code: err.code });
        case "selection_too_large":
          return res.status(422).json({ error: err.message, code: err.code });
        case "invalid_policy":
        case "invalid_predicate":
        default:
          return res.status(400).json({ error: err.message, code: err.code });
      }
    }

    return res.status(500).json({
      error: err?.message || "An unexpected error occurred during policy simulation.",
      code: "internal_error",
    });
  }
}

/**
 * POST /api/admin/policy-simulation/verify-token
 * Body: { token: string, simulationResult: SimulationResult }
 */
export async function VerifyConfirmationToken(
  req: AdminRequest,
  res: Response,
): Promise<Response> {
  const body = (req.body ?? {}) as Record<string, any>;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const simulationResult = body.simulationResult as SimulationResult;

  if (!token) {
    return res.status(400).json({
      error: "Missing confirmation token in request payload.",
      code: "missing_token",
    });
  }

  if (!simulationResult || !simulationResult.policyChange || !simulationResult.preview) {
    return res.status(400).json({
      error: "Missing or malformed simulationResult in request payload.",
      code: "invalid_simulation_result",
    });
  }

  try {
    const isValid = verifySimulationConfirmationToken(token, simulationResult);
    if (!isValid) {
      return res.status(200).json({
        valid: false,
        reason: "confirmation_mismatch_or_drift",
      });
    }

    return res.status(200).json({
      valid: true,
      message: "Confirmation token matches simulation plan with zero record drift.",
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || "Error verifying confirmation token.",
      code: "verification_error",
    });
  }
}
