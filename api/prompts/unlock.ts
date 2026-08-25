import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildChallengeMessage,
  verifyChallengeSignature,
  verifyChallengeToken,
  globalNonceLedger,
} from "../../src/lib/auth/challenge";
import {
  decryptPromptCiphertext,
  hashPromptPlaintext,
  normalizeContentHash,
  unwrapPromptKey,
} from "../../src/lib/crypto/promptCrypto";
import {
  getPrompt,
  hasAccess,
  verifyEntitlement,
  type PromptHashConfig,
  type LedgerVerifiedEntitlement,
  DEFAULT_MAX_LEDGER_AGE,
} from "../../src/lib/stellar/promptHashClient";
import { fetchCiphertextFromIpfs } from "../../src/lib/ipfs/gateway";
import { isIpfsReference } from "../../src/lib/ipfs/reference";
import { withObservability } from "../../src/lib/observability/wrapper";
import { checkRateLimit } from "../../src/lib/observability/rateLimiter";
import { checkReplayProtection } from "../../src/lib/observability/replayProtection";
import {
  checkIdempotency,
  storeIdempotencyResult,
} from "../../src/lib/observability/idempotency";
import { metrics } from "../../src/lib/observability/metrics";
import { recordAuditEvent } from "../../server/src/services/auditTrail";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";
import { validateUnlockSecrets } from "../../src/lib/validation/envValidator";

export interface UnlockRequest {
  token: string;
  promptId: string;
  address: string;
  signedMessage: string;
  idempotencyKey?: string;
}

export interface UnlockSuccessResponse {
  promptId: string;
  title: string;
  contentHash: string;
  plaintext: string;
}

// Fail-fast module load validation
try {
  validateUnlockSecrets();
} catch (err: any) {
  console.error(err.message);
}


/**
 * Get active secrets for token verification
 * Supports multiple secrets during rotation grace period
 */
function getActiveSecrets(primarySecret: string): string[] {
  const secrets = [primarySecret];
  
  // Check for previous secret within grace period
  const previousSecret = process.env.CHALLENGE_TOKEN_SECRET_PREVIOUS;
  const rotationTimestamp = parseInt(
    process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP || "0",
    10
  );
  const gracePeriodMs = parseInt(
    process.env.CHALLENGE_TOKEN_GRACE_PERIOD_MS || "300000", // 5 minutes default
    10
  );
  
  if (previousSecret && rotationTimestamp) {
    const timeSinceRotation = Date.now() - rotationTimestamp;
    if (timeSinceRotation < gracePeriodMs) {
      secrets.push(previousSecret);
    }
  }
  
  return secrets;
}

function getServerConfig(): PromptHashConfig {
  const manifest = getServerDeploymentManifest();
  return {
    rpcUrl: manifest.rpcUrl,
    networkPassphrase: manifest.networkPassphrase,
    promptHashContractId: manifest.promptHashContractId,
    nativeAssetContractId: manifest.nativeAssetContractId,
    simulationAccount: manifest.simulationAccount,
    allowHttp: new URL(manifest.rpcUrl).hostname === "localhost",
  };
}

async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    validateUnlockSecrets();
  } catch (err: any) {
    console.error("Configuration validation failed", { error: err.message });
    res.status(500).json(apiError(ErrorCode.CONFIGURATION_ERROR, "Configuration error."));
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json(apiError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."));
    return;
  }

  const clientIp = String(
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
  );
  const { token, promptId, address, signedMessage, idempotencyKey }: Partial<UnlockRequest> = req.body ?? {};

  // Authenticated bucket: wallet address is present.
  const isAuthenticated = Boolean(address);

  // Rate limit by IP (unauthenticated bucket — strictest guard).
  const ipRateLimit = await checkRateLimit("unlock", clientIp, false);
  if (!ipRateLimit.success) {
    req.logger.warn({ clientIp }, "Rate limit exceeded for unlock (IP)");
    metrics.trackRateLimitHit("unlock_ip", clientIp);
    void recordAuditEvent({
      action: "unlock_rate_limited",
      result: "blocked",
      promptId: promptId ? String(promptId) : null,
      walletAddress: address ? String(address) : null,
      requestId: req.requestId ?? null,
      clientIp,
      reason: "ip_rate_limit_exceeded",
    });
    res.setHeader("X-RateLimit-Limit", ipRateLimit.limit);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader("X-RateLimit-Reset", ipRateLimit.reset);
    res.status(429).json(
      apiError(ErrorCode.RATE_LIMIT_IP, "Too many requests. Please try again later.", {
        reset: ipRateLimit.reset,
      }),
    );
    return;
  }

  // Rate limit by wallet address (authenticated bucket — per-wallet brute-force guard).
  if (address) {
    const walletRateLimit = await checkRateLimit("unlock", String(address), isAuthenticated);
    if (!walletRateLimit.success) {
      req.logger.warn({ address }, "Rate limit exceeded for unlock (Wallet)");
      metrics.trackRateLimitHit("unlock_wallet", String(address));
      void recordAuditEvent({
        action: "unlock_rate_limited",
        result: "blocked",
        promptId: promptId ? String(promptId) : null,
        walletAddress: String(address),
        requestId: req.requestId ?? null,
        clientIp,
        reason: "wallet_rate_limit_exceeded",
      });
      res.setHeader("X-RateLimit-Limit", walletRateLimit.limit);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", walletRateLimit.reset);
      res.status(429).json(
        apiError(ErrorCode.RATE_LIMIT_WALLET, "Too many unlock attempts for this wallet.", {
          reset: walletRateLimit.reset,
        }),
      );
      return;
    }
  }

  const challengeSecret = process.env.CHALLENGE_TOKEN_SECRET;
  const unlockPublicKey = process.env.UNLOCK_PUBLIC_KEY;
  const unlockPrivateKey = process.env.UNLOCK_PRIVATE_KEY;

  if (!challengeSecret || !unlockPublicKey || !unlockPrivateKey) {
    req.logger.error("Unlock service is missing configuration secrets.");
    res.status(500).json(apiError(ErrorCode.CONFIGURATION_ERROR, "Configuration error."));
    return;
  }

  if (!token || !promptId || !address || !signedMessage) {
    res.status(400).json(
      apiError(
        ErrorCode.MISSING_FIELDS,
        "token, promptId, address, and signedMessage are required.",
      ),
    );
    return;
  }

// ── Idempotency ─────────────────────────────────────────────────────
  if (idempotencyKey) {
    const idempCheck = await checkIdempotency(
      String(idempotencyKey),
      String(token),
      String(promptId),
      String(address),
      String(signedMessage),
    );

    if (idempCheck.status === "cached") {
      req.logger.info({ idempotencyKey }, "Returning cached idempotent unlock response");
      res.status(idempCheck.statusCode).json(idempCheck.responseData);
      return;
    }

    if (idempCheck.status === "conflict") {
      req.logger.warn({ idempotencyKey }, "Idempotency key reused with conflicting request data");
      res.status(409).json(
        apiError(
          ErrorCode.IDEMPOTENCY_CONFLICT,
          "This idempotency key was used with a different request. Please use a new key.",
        ),
      );
      return;
    }
  }

  const unlockStartMs = Date.now();

  try {
    // Support multiple active secrets during rotation grace period
    const activeSecrets = getActiveSecrets(challengeSecret);
    
    const payload = verifyChallengeToken(
      activeSecrets,
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
      req.logger.warn({ address, promptId }, "Invalid wallet signature");
      metrics.trackUnlockFailure(String(address), String(promptId), "invalid_signature");
      void recordAuditEvent({
        action: "unlock_invalid_signature",
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

    // Nonce-based replay protection: ensure this nonce is consumed only once
    const nonceConsumed = await globalNonceLedger.consume(payload.nonce, payload.expiresAt);
    if (!nonceConsumed) {
      req.logger.warn({ address, promptId, nonce: payload.nonce }, "Replay attack detected (nonce already consumed)");
      metrics.trackUnlockFailure(String(address), String(promptId), "replay_detected");
      void recordAuditEvent({
        action: "unlock_replay_detected",
        result: "blocked",
        promptId: String(promptId),
        walletAddress: String(address),
        requestId: req.requestId ?? null,
        clientIp,
        reason: "replay_attack",
      });
      res.status(400).json(
        apiError(ErrorCode.TEMPORARY_FAILURE, "This unlock request has already been processed."),
      );
      return;
    }

    const replayCheck = await checkReplayProtection(
      String(token),
      String(signedMessage),
    );
    if (!replayCheck.valid) {
      req.logger.warn({ address, promptId }, "Replay attack detected");
      metrics.trackUnlockFailure(String(address), String(promptId), "replay_detected");
      void recordAuditEvent({
        action: "unlock_replay_detected",
        result: "blocked",
        promptId: String(promptId),
        walletAddress: String(address),
        requestId: req.requestId ?? null,
        clientIp,
        reason: "replay_attack",
      });
      res.status(400).json(
        apiError(ErrorCode.TEMPORARY_FAILURE, "This unlock request has already been processed."),
      );
      return;
    }

    const config = getServerConfig();
    const id = BigInt(promptId);

    // Verify entitlement against finalized ledger state (#545).
    // Binds the access decision to ledger_sequence, ledger_hash, network_id,
    // and contract_id with a strict freshness threshold.
    // Fail-closed: if RPC is unreachable or state is stale, deny access.
    let entitlement: LedgerVerifiedEntitlement;
    try {
      entitlement = await verifyEntitlement(
        config,
        String(address),
        id,
        DEFAULT_MAX_LEDGER_AGE,
      );
    } catch {
      req.logger.error({ address, promptId }, "Ledger entitlement verification failed (RPC error)");
      metrics.trackUnlockFailure(String(address), String(promptId), "ledger_verification_failed");
      void recordAuditEvent({
        action: "unlock_ledger_failure",
        result: "blocked",
        promptId: String(promptId),
        walletAddress: String(address),
        requestId: req.requestId ?? null,
        clientIp,
        reason: "ledger_verification_failed",
      });
      res.status(403).json(
        apiError(ErrorCode.ACCESS_NOT_PURCHASED, "Unable to verify access. Please try again."),
      );
      return;
    }

    if (!entitlement.hasAccess) {
      req.logger.warn(
        { address, promptId, ledgerSequence: entitlement.ledgerSequence, ledgerHash: entitlement.ledgerHash },
        "Prompt access denied (ledger-verified)",
      );
      metrics.trackUnlockFailure(String(address), String(promptId), "no_access");
      void recordAuditEvent({
        action: "unlock_no_access",
        result: "failure",
        promptId: String(promptId),
        walletAddress: String(address),
        requestId: req.requestId ?? null,
        clientIp,
        reason: "no_access",
      });
      res.status(403).json(
        apiError(ErrorCode.ACCESS_NOT_PURCHASED, "Prompt access has not been purchased."),
      );
      return;
    }

    req.logger.info(
      {
        address,
        promptId,
        ledgerSequence: entitlement.ledgerSequence,
        ledgerHash: entitlement.ledgerHash,
        networkId: entitlement.networkId,
        contractId: entitlement.contractId,
      },
      "Entitlement verified against finalized ledger state",
    );

    const prompt = await getPrompt(config, id);
    const keyBytes = await unwrapPromptKey(
      prompt.wrappedKey,
      unlockPublicKey,
      unlockPrivateKey,
    );

    // Large payloads are stored on IPFS with only an `ipfs://<cid>` reference
    // kept on-chain — fetch the ciphertext back before decrypting. Inline
    // payloads (legacy listings) are decrypted directly.
    const ciphertext = isIpfsReference(prompt.encryptedPrompt)
      ? await fetchCiphertextFromIpfs(prompt.encryptedPrompt)
      : prompt.encryptedPrompt;

    const plaintext = await decryptPromptCiphertext(
      ciphertext,
      prompt.encryptionIv,
      keyBytes,
    );
    const contentHash = await hashPromptPlaintext(plaintext);
    const storedHash = normalizeContentHash(prompt.contentHash);
    if (contentHash !== storedHash) {
      req.logger.error({ address, promptId }, "Prompt integrity check failed");
      metrics.trackUnlockFailure(String(address), String(promptId), "integrity_failure");
      void recordAuditEvent({
        action: "unlock_integrity_failure",
        result: "failure",
        promptId: String(promptId),
        walletAddress: String(address),
        requestId: req.requestId ?? null,
        clientIp,
        reason: "integrity_failure",
      });
      res.status(500).json(
        apiError(ErrorCode.INTEGRITY_FAILURE, "Prompt integrity check failed."),
      );
      return;
    }

    metrics.trackUnlockSuccess(String(address), String(promptId));
    metrics.trackUnlockLatency(Date.now() - unlockStartMs);
    req.logger.info({ address, promptId }, "Prompt unlocked successfully");
    void recordAuditEvent({
      action: "unlock_success",
      result: "success",
      promptId: String(promptId),
      walletAddress: String(address),
      requestId: req.requestId ?? null,
      clientIp,
      reason: null,
    });

    // The Soroban indexer is the sole source of `PromptPurchased` webhook
    // deliveries (#536) — it has the authoritative on-chain buyer/price/
    // txHash and a stable per-event dedupe key, so unlock no longer fires a
    // second, independent notification for the same purchase.

    const successResponse: UnlockSuccessResponse = {
      promptId: prompt.id.toString(),
      title: prompt.title,
      contentHash,
      plaintext,
    };
    if (idempotencyKey) {
      void storeIdempotencyResult(
        String(idempotencyKey),
        String(token),
        String(promptId),
        String(address),
        String(signedMessage),
        200,
        successResponse,
      );
    }
    res.status(200).json(successResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to unlock prompt.";
    req.logger.error({ address, promptId, error: message }, "Unlock attempt failed");
    metrics.trackUnlockFailure(String(address), String(promptId), "error");
    metrics.trackUnlockLatency(Date.now() - unlockStartMs);

    // Distinguish expired-challenge errors for finer-grained audit reasons and error codes.
    const isExpired = message.toLowerCase().includes("expired");
    void recordAuditEvent({
      action: isExpired ? "unlock_expired_challenge" : "unlock_error",
      result: "failure",
      promptId: promptId ? String(promptId) : null,
      walletAddress: address ? String(address) : null,
      requestId: req.requestId ?? null,
      clientIp,
      reason: isExpired ? "expired_challenge" : "error",
    });

    if (isExpired) {
      const body = apiError(ErrorCode.CHALLENGE_EXPIRED, "The challenge token has expired. Please request a new one.");
      if (idempotencyKey) {
        void storeIdempotencyResult(
          String(idempotencyKey),
          String(token),
          String(promptId),
          String(address),
          String(signedMessage),
          400,
          body,
        );
      }
      res.status(400).json(body);
    } else {
      const body = apiError(ErrorCode.TEMPORARY_FAILURE, "Failed to unlock prompt. Please try again.");
      if (idempotencyKey) {
        void storeIdempotencyResult(
          String(idempotencyKey),
          String(token),
          String(promptId),
          String(address),
          String(signedMessage),
          400,
          body,
        );
      }
      res.status(400).json(body);
    }
  }
}

export default withObservability(handler, "prompts/unlock");
