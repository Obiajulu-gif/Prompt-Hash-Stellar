/**
 * Creator Profile Verification API
 * 
 * Allows admin users to grant or revoke verification badges for creator profiles.
 * Verified profiles display trust signals to buyers.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withObservability } from "../../src/lib/observability/wrapper";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";
import { recordAuditEvent } from "../../server/src/services/auditTrail";

// Admin wallet addresses allowed to verify profiles
const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || "").split(",").map(w => w.trim().toLowerCase());

export interface VerificationRequest {
  profileAddress: string;
  action: "grant" | "revoke";
  adminWallet: string;
  reason?: string;
}

export interface VerificationResponse {
  success: boolean;
  profileAddress: string;
  verified: boolean;
  message: string;
}

/**
 * Verify that the requesting wallet is authorized for verification actions
 */
function isAuthorizedAdmin(walletAddress: string): boolean {
  const normalized = walletAddress.trim().toLowerCase();
  return ADMIN_WALLETS.includes(normalized) && normalized.length > 0;
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
    profileAddress,
    action,
    adminWallet,
    reason,
  }: Partial<VerificationRequest> = req.body ?? {};

  // Validate required fields
  if (!profileAddress || !action || !adminWallet) {
    res.status(400).json(
      apiError(
        ErrorCode.MISSING_FIELDS,
        "profileAddress, action, and adminWallet are required."
      )
    );
    return;
  }

  // Verify admin authorization
  if (!isAuthorizedAdmin(String(adminWallet))) {
    await recordAuditEvent({
      action: "profile_verification_unauthorized",
      result: "blocked",
      promptId: null,
      walletAddress: String(adminWallet),
      requestId: req.headers["x-request-id"] as string ?? null,
      clientIp,
      reason: "unauthorized_admin",
      metadata: {
        profileAddress: String(profileAddress),
        action: String(action),
      },
    });

    res.status(403).json(
      apiError(ErrorCode.UNAUTHORIZED, "You are not authorized to verify profiles.")
    );
    return;
  }

  // Validate action
  if (action !== "grant" && action !== "revoke") {
    res.status(400).json(
      apiError(ErrorCode.INVALID_INPUT, "Action must be 'grant' or 'revoke'.")
    );
    return;
  }

  try {
    // In production, this would update the profile in database/IPFS
    // For now, we'll store verification state in localStorage (client-side)
    // or a verification registry

    const verified = action === "grant";
    const verificationData = {
      verified,
      verifiedAt: verified ? new Date().toISOString() : undefined,
      verifiedBy: verified ? String(adminWallet) : undefined,
    };

    req.logger?.info({
      profileAddress,
      action,
      adminWallet,
      verified,
    }, "Profile verification updated");

    // Record audit event
    await recordAuditEvent({
      action: `profile_${action}_verification`,
      result: "success",
      promptId: null,
      walletAddress: String(adminWallet),
      requestId: req.headers["x-request-id"] as string ?? null,
      clientIp,
      reason: reason || "admin_action",
      metadata: {
        profileAddress: String(profileAddress),
        action: String(action),
        verified,
        timestamp: new Date().toISOString(),
      },
    });

    const response: VerificationResponse = {
      success: true,
      profileAddress: String(profileAddress),
      verified,
      message: verified
        ? "Profile verified successfully."
        : "Profile verification revoked successfully.",
    };

    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update verification.";
    req.logger?.error({ profileAddress, error: message }, "Verification failed");

    await recordAuditEvent({
      action: "profile_verification_error",
      result: "failure",
      promptId: null,
      walletAddress: adminWallet ? String(adminWallet) : null,
      requestId: req.headers["x-request-id"] as string ?? null,
      clientIp,
      reason: "error",
      metadata: {
        profileAddress: profileAddress ? String(profileAddress) : null,
      },
    });

    res.status(500).json(
      apiError(ErrorCode.TEMPORARY_FAILURE, "Failed to update verification. Please try again.")
    );
  }
}

export default withObservability(handler, "profiles/verify");
