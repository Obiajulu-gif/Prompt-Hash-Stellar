/**
 * Prompt Moderation API Endpoint
 *
 * Allows admin users to moderate prompts for policy violations (copyright, abuse, malware).
 * Restricted prompts are hidden from public marketplace but preserve buyer access records.
 * Error responses and status updates use i18n keys for localization.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withObservability } from "../../src/lib/observability/wrapper";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";
import connectDb from "../../server/src/db/connectDb";
import { recordAuditEvent } from "../../server/src/services/auditTrail";
import {
  transitionPromptLifecycle,
  PromptNotFoundError,
} from "../../server/src/services/promptLifecycle";
import { LifecycleTransitionError, type LifecycleState } from "@prompthash/schema";
import { 
  setPromptSaleStatus, 
  getPrompt,
  type PromptHashConfig,
} from "../../src/lib/stellar/promptHashClient";
import { browserStellarConfig } from "../../src/lib/stellar/browserConfig";
import {
  mapActionToStatusKey,
  mapReasonToKey,
} from "../../src/lib/i18n/serverMessages";

// Admin wallet addresses allowed to moderate content
const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || "")
  .split(",")
  .map((w) => w.trim().toLowerCase());

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
  newStatusKey: string;
  reasonKey: string;
  message: string;
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
 * Map a moderation action to the target lifecycle state (Issue #786).
 * A restricted listing is hidden (not archived) so it can be reinstated
 * without losing history; retirement is terminal-ish (archived).
 */
function mapActionToLifecycleState(action: string): LifecycleState {
  switch (action) {
    case "restrict":
      return "hidden";
    case "reinstate":
      return "published";
    case "retire":
      return "archived";
    default:
      throw new Error(`Invalid moderation action: ${action}`);
  }
}

function mapActionToModerationStatus(action: string): "none" | "restricted" | "retired" {
  switch (action) {
    case "restrict":
      return "restricted";
    case "reinstate":
      return "none";
    case "retire":
      return "retired";
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

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res
      .status(405)
      .json(apiError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."));
    return;
  }

  const clientIp = String(
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
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
    res
      .status(400)
      .json(
        apiError(
          ErrorCode.MISSING_FIELDS,
          "promptId, action, reason, policyReference, and adminWallet are required.",
        ),
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
      requestId: (req.headers["x-request-id"] as string) ?? null,
      clientIp,
      reason: "unauthorized_admin",
    });

    res
      .status(403)
      .json(
        apiError(
          ErrorCode.UNAUTHORIZED,
          "You are not authorized to moderate content.",
        ),
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
      res
        .status(404)
        .json(
          apiError(ErrorCode.PROMPT_NOT_FOUND, "Prompt not found on-chain."),
        );
      return;
    }

    const newStatus = mapActionToStatus(String(action));
    const moderationReason = mapReasonToEnum(String(reason));
    const lifecycleTarget = mapActionToLifecycleState(String(action));
    const moderationStatusValue = mapActionToModerationStatus(String(action));

    // Update prompt status on-chain via contract call
    // Note: This requires admin wallet to sign the transaction
    // In production, this would use a secure signing service
    req.logger?.info(
      {
        promptId,
        action,
        reason,
        adminWallet,
        newStatus,
      },
      "Moderating prompt",
    );

    // Issue #786: route through the lifecycle state machine instead of
    // writing listingStatus/moderationStatus fields directly — this
    // rejects moderating a prompt whose current lifecycle state doesn't
    // allow the requested transition (e.g. reinstating one that was never
    // suspended/restricted), and records the transition in both the
    // tamper-evident audit trail and the prompt's own lifecycleHistory.
    try {
      await transitionPromptLifecycle({
        promptId: String(promptId),
        by: "onChainId",
        to: lifecycleTarget,
        actor: { role: "moderator", id: String(adminWallet) },
        reason: `${reason}: ${policyReference}`,
        requestId: (req.headers["x-request-id"] as string) ?? null,
        clientIp,
        moderation: {
          status: moderationStatusValue,
          reasonCode: String(reason),
          notes: notes || "",
        },
      });
    } catch (err) {
      if (err instanceof LifecycleTransitionError) {
        res.status(409).json(
          apiError(
            ErrorCode.INVALID_STATE,
            `Cannot ${action} this prompt from its current lifecycle state.`,
          ),
        );
        return;
      }
      if (err instanceof PromptNotFoundError) {
        res.status(404).json(
          apiError(ErrorCode.PROMPT_NOT_FOUND, "Prompt not found in the marketplace index."),
        );
        return;
      }
      throw err;
    }

    const response: ModerationResponse = {
      success: true,
      promptId: String(promptId),
      newStatus,
      newStatusKey: mapActionToStatusKey(String(action)),
      reasonKey: mapReasonToKey(String(reason)),
      message: `Prompt ${action === "restrict" ? "restricted" : action === "reinstate" ? "reinstated" : "retired"} successfully.`,
    };

    res.status(200).json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to moderate prompt.";
    req.logger?.error({ promptId, error: message }, "Moderation failed");

    await recordAuditEvent({
      action: "moderation_error",
      result: "failure",
      promptId: promptId ? String(promptId) : null,
      walletAddress: adminWallet ? String(adminWallet) : null,
      requestId: (req.headers["x-request-id"] as string) ?? null,
      clientIp,
      reason: "error",
    });

    res
      .status(500)
      .json(
        apiError(
          ErrorCode.TEMPORARY_FAILURE,
          "Failed to moderate prompt. Please try again.",
        ),
      );
  }
}

export default withObservability(handler, "prompts/moderate");
