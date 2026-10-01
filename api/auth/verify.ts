import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildChallengeMessage,
  verifyChallengeSignature,
  verifyChallengeToken,
} from "../../src/lib/auth/challenge";
import { withObservability } from "../../src/lib/observability/wrapper";
import { checkReplayProtection } from "../../src/lib/observability/replayProtection";
import { metrics } from "../../src/lib/observability/metrics";
import { recordAuditEvent } from "../../server/src/services/auditTrail";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";
import { isPlaceholder } from "../../src/lib/validation/envValidator";

export interface WalletVerifyRequest {
  address: string;
  token: string;
  signedMessage: string;
  promptId: string;
}

export interface WalletVerifyResponse {
  address: string;
  authenticated: true;
  expiresAt: number;
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json(apiError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."));
    return;
  }

  const secret = process.env.CHALLENGE_TOKEN_SECRET;
  if (!secret || isPlaceholder(secret) || secret.length < 16) {
    req.logger.error("CHALLENGE_TOKEN_SECRET is not configured correctly.");
    res.status(500).json(apiError(ErrorCode.CONFIGURATION_ERROR, "Configuration error."));
    return;
  }

  const clientIp = String(
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
  );
  const { address, token, signedMessage, promptId }: Partial<WalletVerifyRequest> =
    req.body ?? {};

  if (!address || !token || !signedMessage || !promptId) {
    res.status(400).json(
      apiError(
        ErrorCode.MISSING_FIELDS,
        "address, token, signedMessage, and promptId are required.",
      ),
    );
    return;
  }

  try {
    const payload = verifyChallengeToken(
      secret,
      String(token),
      String(address),
      String(promptId),
    );
    const challengeMessage = buildChallengeMessage(payload);
    const validSignature = verifyChallengeSignature(
      String(address),
      challengeMessage,
      String(signedMessage),
    );

    if (!validSignature) {
      metrics.trackUnlockFailure(String(address), String(promptId), "invalid_auth_signature");
      void recordAuditEvent({
        action: "wallet_auth_invalid_signature",
        result: "failure",
        promptId: String(promptId),
        walletAddress: String(address),
        requestId: req.requestId ?? null,
        clientIp,
        reason: "invalid_signature",
      });
      res.status(401).json(apiError(ErrorCode.INVALID_SIGNATURE, "Invalid wallet signature."));
      return;
    }

    const replayCheck = await checkReplayProtection(String(token), String(signedMessage));
    if (!replayCheck.valid) {
      void recordAuditEvent({
        action: "wallet_auth_replay_detected",
        result: "blocked",
        promptId: String(promptId),
        walletAddress: String(address),
        requestId: req.requestId ?? null,
        clientIp,
        reason: "replay_attack",
      });
      res.status(400).json(
        apiError(ErrorCode.TEMPORARY_FAILURE, "This sign-in request has already been processed."),
      );
      return;
    }

    void recordAuditEvent({
      action: "wallet_auth_success",
      result: "success",
      promptId: String(promptId),
      walletAddress: String(address),
      requestId: req.requestId ?? null,
      clientIp,
      reason: null,
    });

    const response: WalletVerifyResponse = {
      address: String(address),
      authenticated: true,
      expiresAt: payload.expiresAt,
    };
    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet authentication failed.";
    const isExpired = message.toLowerCase().includes("expired");
    void recordAuditEvent({
      action: isExpired ? "wallet_auth_expired_challenge" : "wallet_auth_error",
      result: "failure",
      promptId: promptId ? String(promptId) : null,
      walletAddress: address ? String(address) : null,
      requestId: req.requestId ?? null,
      clientIp,
      reason: isExpired ? "expired_challenge" : "error",
    });

    res.status(400).json(
      apiError(
        isExpired ? ErrorCode.CHALLENGE_EXPIRED : ErrorCode.CHALLENGE_INVALID,
        isExpired
          ? "The wallet sign-in challenge has expired. Please try again."
          : "Wallet authentication failed.",
      ),
    );
  }
}

export default withObservability(handler, "auth/verify");
