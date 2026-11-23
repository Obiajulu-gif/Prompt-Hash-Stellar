/**
 * Privileged Action Signed Receipt Service (#1127)
 *
 * Provides cryptographic, non-repudiable audit receipts for high-privilege operations
 * performed by administrators and maintainers (e.g. payout release, emergency halts,
 * permission grants, fee updates, record merges, and compliance actions).
 *
 * Guarantees:
 *  - Canonical JSON serialization with SHA-256 digest of action payloads.
 *  - Cryptographic HMAC-SHA256 signature binding receipt metadata and payload digest.
 *  - Strict idempotency protection preventing duplicate executions or side effects.
 *  - Full coverage of SUCCESS, FAILED, and PENDING operation lifecycle states.
 *  - Seamless integration with existing AuditTrail and MaintainerAccess systems.
 */

import {
  SignedReceipt,
  ISignedReceipt,
  IExternalReferences,
} from "../models/SignedReceipt";
import { SignedReceiptService, ReceiptVerificationResult } from "./signedReceiptService";
import { recordAuditEvent } from "./auditTrail";
import { logger } from "./structuredLogger";

export interface PrivilegedActionParams {
  actor: string;
  action: string;
  scope: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  payload: Record<string, unknown>;
  target?: string;
  targetType?: string;
  grantId?: string;
  promptId?: string;
  txHash?: string;
  idempotencyKey?: string;
  reason?: string;
}

export class PrivilegedReceiptError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PrivilegedReceiptError";
  }
}

export class PrivilegedActionReceiptService {
  /**
   * Issues an immutable, cryptographically signed audit receipt for a privileged action.
   * Time Complexity: O(K) where K is the serialized byte length of the payload.
   * Space Complexity: O(K) memory to store the canonical representation and digest.
   */
  public static async issueReceipt(params: PrivilegedActionParams): Promise<ISignedReceipt> {
    const actor = (params.actor || "").trim().toLowerCase();
    if (!actor) {
      throw new PrivilegedReceiptError("MISSING_ACTOR", "Actor is required for privileged receipts.");
    }
    if (!params.action || !params.scope) {
      throw new PrivilegedReceiptError("INVALID_METADATA", "Privileged action and scope must be specified.");
    }

    const idempotencyKey =
      params.idempotencyKey ||
      (params.grantId ? `priv:${params.grantId}:${params.action}:${params.status}` : undefined);

    const externalReferences: IExternalReferences = {
      idempotencyKey,
      grantId: params.grantId,
      promptId: params.promptId,
      txHash: params.txHash,
      scope: params.scope,
      target: params.target,
      targetType: params.targetType,
    };

    // If an idempotency key is provided and a matching receipt exists, return the existing receipt
    if (idempotencyKey) {
      const existing = await SignedReceipt.findOne({
        "externalReferences.idempotencyKey": idempotencyKey,
      });
      if (existing) {
        logger.info("Reusing existing privileged audit receipt for idempotency key", {
          receiptId: existing.receiptId,
          idempotencyKey,
          status: existing.status,
        });
        return existing;
      }
    }

    // Embed privileged action metadata in payload for cryptographic binding
    const enrichedPayload: Record<string, unknown> = {
      action: params.action,
      scope: params.scope,
      target: params.target || null,
      targetType: params.targetType || null,
      reason: params.reason || null,
      grantId: params.grantId || null,
      ...params.payload,
    };

    const receipt = await SignedReceiptService.createReceipt({
      operationType: "PRIVILEGED_ACTION",
      actor,
      status: params.status,
      payload: enrichedPayload,
      externalReferences,
    });

    // Mirror to audit trail for cross-system queryability
    try {
      await recordAuditEvent({
        action: `privileged_${params.action.replace(/[^a-zA-Z0-9_]/g, "_")}`,
        result: params.status === "SUCCESS" ? "success" : params.status === "FAILED" ? "failure" : "pending",
        actor,
        target: params.target || receipt.receiptId,
        targetType: params.targetType || "privileged_receipt",
        promptId: params.promptId || null,
        reason: params.reason || `Privileged action ${params.action} (${params.status})`,
      });
    } catch (auditErr) {
      logger.warn("Could not record auxiliary audit event for privileged receipt", {
        error: auditErr,
        receiptId: receipt.receiptId,
      });
    }

    return receipt;
  }

  /**
   * Verifies the authenticity and signature integrity of a privileged receipt.
   * Time Complexity: O(K) where K is payload size.
   * Space Complexity: O(K) to re-serialize and hash.
   */
  public static verifyReceipt(receipt: unknown): ReceiptVerificationResult {
    return SignedReceiptService.verifyReceipt(receipt);
  }

  /**
   * Retrieves all privileged receipts for a specific target entity (e.g. prompt, user, payout).
   */
  public static async getReceiptsByTarget(
    target: string,
    limit = 20,
  ): Promise<ISignedReceipt[]> {
    return SignedReceipt.find({
      operationType: "PRIVILEGED_ACTION",
      "externalReferences.target": target,
    })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();
  }

  /**
   * Retrieves all privileged receipts issued to a specific operator/actor.
   */
  public static async getReceiptsByActor(
    actor: string,
    limit = 20,
  ): Promise<ISignedReceipt[]> {
    return SignedReceipt.find({
      operationType: "PRIVILEGED_ACTION",
      actor: actor.toLowerCase(),
    })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();
  }
}

