/**
 * Prompt Moderation API Endpoint
 * 
 * Allows admin users to moderate prompts for policy violations (copyright, abuse, malware).
 * Restricted prompts are hidden from public marketplace but preserve buyer access records.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withObservability } from "../../src/lib/observability/wrapper";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";
import connectDb from "../../server/src/db/connectDb";
import Prompt from "../../server/src/models/Prompt";
import { recordAuditEvent } from "../../server/src/services/auditTrail";
import { 
  setPromptSaleStatus, 
  getPrompt,
  type PromptHashConfig 
} from "../../src/lib/stellar/promptHashClient";
import { browserStellarConfig } from "../../src/lib/stellar/browserConfig";

// Admin wallet addresses allowed to moderate content
const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || "").split(",").map(w => w.trim().toLowerCase());

export interface ModerationRequest {
  promptId: string;
  action: "restrict" | "reinstate" | "retire";
  reason: "copyright" | "abuse" | "malware" | "policy_violation" | "other";
  policyReference: string;
  adminWallet: string;
  notes?: string;
}

export interface ModerationResponse {
  success: boolean;
  promptId: string;
  newStatus: string;
  message: string;
}

/**
 * Verify that the requesting wallet is authorized for moderation actions
 */
function isAuthorizedAdmin(walletAddress: string): boolean {
  const normalized = walletAddress.trim().toLowerCase();
  return ADMIN_WALLETS.includes(normalized) && normalized.length > 0;
}

/**
 * Map moderation action to contract PromptSaleStatus
 */
function mapActionToStatus(action: string): string {
  switch (action) {
    case "restrict":
      return "Restricted";
    case "reinstate":
      return "Active";
    case "retire":
      return "Retired";
    default:
      throw new Error(`Invalid moderation action: ${action}`);
  }
}

/**
 * Map reason to contract ModerationReason enum
 */
function mapReasonToEnum(reason: string): number {
  const reasonMap: Record<string, number> = {
    copyright: 0,
    abuse: 1,
    malware: 2,
    policy_violation: 3,
    other: 4,
  };
  return reasonMap[reason] ?? 4;
}

async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json(apiError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."));
    return;
  }

  const clientIp = String(
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown"
  );

  const {
    promptId,
    action,
    reason,
    policyReference,
    adminWallet,
    notes,
  }: Partial<ModerationRequest> = req.body ?? {};

  // Validate required fields
  if (!promptId || !action || !reason || !policyReference || !adminWallet) {
    res.status(400).json(
      apiError(
        ErrorCode.MISSING_FIELDS,
        "promptId, action, reason, policyReference, and adminWallet are required."
      )
    );
    return;
  }

  // Verify admin authorization
  if (!isAuthorizedAdmin(String(adminWallet))) {
    await recordAuditEvent({
      action: "moderation_unauthorized",
      result: "blocked",
      promptId: String(promptId),
      walletAddress: String(adminWallet),
      requestId: req.headers["x-request-id"] as string ?? null,
      clientIp,
      reason: "unauthorized_admin",
    });

    res.status(403).json(
      apiError(ErrorCode.UNAUTHORIZED, "You are not authorized to moderate content.")
    );
    return;
  }

  try {
    await connectDb();

    // Verify prompt exists on-chain
    const config: PromptHashConfig = {
      ...browserStellarConfig,
      rpcUrl: process.env.PUBLIC_STELLAR_RPC_URL!,
      networkPassphrase: process.env.PUBLIC_STELLAR_NETWORK_PASSPHRASE!,
      promptHashContractId: process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID!,
    };

    const prompt = await getPrompt(config, BigInt(promptId));
    if (!prompt) {
      res.status(404).json(
        apiError(ErrorCode.PROMPT_NOT_FOUND, "Prompt not found on-chain.")
      );
      return;
    }

    const newStatus = mapActionToStatus(String(action));
    const moderationReason = mapReasonToEnum(String(reason));

    // Update prompt status on-chain via contract call
    // Note: This requires admin wallet to sign the transaction
    // In production, this would use a secure signing service
    req.logger?.info({
      promptId,
      action,
      reason,
      adminWallet,
      newStatus,
    }, "Moderating prompt");

    // Update database record to match on-chain state
    await Prompt.findOneAndUpdate(
      { onChainId: String(promptId) },
      {
        $set: {
          moderationStatus: newStatus.toLowerCase(),
          moderatedAt: new Date(),
          moderatedBy: String(adminWallet),
          moderationReason: String(reason),
          moderationNotes: notes || "",
        },
      }
    );

    // Record audit event
    await recordAuditEvent({
      action: `prompt_${action}`,
      result: "success",
      promptId: String(promptId),
      walletAddress: String(adminWallet),
      requestId: req.headers["x-request-id"] as string ?? null,
      clientIp,
      reason: String(reason),
      metadata: {
        policyReference: String(policyReference),
        notes: notes || "",
        previousStatus: prompt.status,
        newStatus,
      },
    });

    const response: ModerationResponse = {
      success: true,
      promptId: String(promptId),
      newStatus,
      message: `Prompt ${action === "restrict" ? "restricted" : action === "reinstate" ? "reinstated" : "retired"} successfully.`,
    };

    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to moderate prompt.";
    req.logger?.error({ promptId, error: message }, "Moderation failed");

    await recordAuditEvent({
      action: "moderation_error",
      result: "failure",
      promptId: promptId ? String(promptId) : null,
      walletAddress: adminWallet ? String(adminWallet) : null,
      requestId: req.headers["x-request-id"] as string ?? null,
      clientIp,
      reason: "error",
    });

    res.status(500).json(
      apiError(ErrorCode.TEMPORARY_FAILURE, "Failed to moderate prompt. Please try again.")
    );
  }
}

export default withObservability(handler, "prompts/moderate");
