import { createHash, createHmac } from "crypto";
import {
  SignedReceipt,
  ISignedReceipt,
  CriticalOperationType,
  IExternalReferences,
} from "../models/SignedReceipt";
import { canonicalJson, recordAccessOrOwnershipChange } from "./auditTrail";
import { logger } from "./structuredLogger";

export interface CreateReceiptParams {
  operationType: CriticalOperationType;
  actor: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  payload: Record<string, unknown>;
  externalReferences?: IExternalReferences;
}

export interface ReceiptVerificationResult {
  valid: boolean;
  tamperedFields: string[];
  reason?: string;
}

const SIGNING_SECRET =
  process.env.RECEIPT_SIGNING_SECRET ||
  process.env.CHALLENGE_TOKEN_SECRET ||
  "prompt-hash-stellar-default-receipt-secret";

export class SignedReceiptService {
  /**
   * Generates the canonical digest of the operation payload.
   */
  public static computePayloadDigest(payload: Record<string, unknown>): string {
    const canonical = canonicalJson(payload);
    return createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * Generates HMAC-SHA256 signature for the receipt envelope.
   */
  public static computeReceiptSignature(data: {
    receiptId: string;
    operationType: string;
    actor: string;
    status: string;
    timestamp: string;
    nonce: string;
    payloadDigest: string;
    externalReferences: IExternalReferences;
  }): string {
    const signingEnvelope = canonicalJson({
      receiptId: data.receiptId,
      operationType: data.operationType,
      actor: data.actor.toLowerCase(),
      status: data.status,
      timestamp: data.timestamp,
      nonce: data.nonce,
      payloadDigest: data.payloadDigest,
      externalReferences: data.externalReferences,
    });

    return createHmac("sha256", SIGNING_SECRET).update(signingEnvelope).digest("hex");
  }

  /**
   * Create an immutable signed receipt for a critical user operation.
   * Enforces idempotency if an idempotencyKey is provided.
   */
  public static async createReceipt(params: CreateReceiptParams): Promise<ISignedReceipt> {
    const actor = params.actor.toLowerCase();
    const externalReferences = params.externalReferences || {};

    // 1. Idempotency check
    if (externalReferences.idempotencyKey) {
      const existing = await SignedReceipt.findOne({
        "externalReferences.idempotencyKey": externalReferences.idempotencyKey,
      });
      if (existing) {
        logger.info("Returning existing receipt for idempotency key", {
          receiptId: existing.receiptId,
          idempotencyKey: externalReferences.idempotencyKey,
        });
        return existing;
      }
    }

    // 2. Build canonical receipt attributes
    const now = new Date();
    const timestamp = now.toISOString();
    const nonce = `nonce_${now.getTime()}_${Math.random().toString(36).substring(2, 9)}`;
    const receiptId = `rcpt_${now.getTime()}_${Math.random().toString(36).substring(2, 8)}`;
    const payloadDigest = this.computePayloadDigest(params.payload);

    const signature = this.computeReceiptSignature({
      receiptId,
      operationType: params.operationType,
      actor,
      status: params.status,
      timestamp,
      nonce,
      payloadDigest,
      externalReferences,
    });

    // 3. Persist receipt
    const receipt = await SignedReceipt.create({
      receiptId,
      operationType: params.operationType,
      actor,
      status: params.status,
      timestamp,
      nonce,
      externalReferences,
      payload: params.payload,
      payloadDigest,
      signature,
      signatureAlgorithm: "HMAC-SHA256",
      issuedBy: "prompt-hash-stellar",
    });

    // 4. Record in audit trail
    try {
      await recordAccessOrOwnershipChange({
        action: "receipt_generated",
        result: "success",
        actor,
        target: receiptId,
        targetType: "system",
        promptId: externalReferences.promptId,
        walletAddress: actor,
        beforeState: null,
        afterState: {
          receiptId,
          operationType: params.operationType,
          status: params.status,
          payloadDigest,
        },
        reason: `Receipt generated for ${params.operationType}`,
      });
    } catch (err) {
      logger.warn("Could not audit receipt creation", { error: err });
    }

    return receipt;
  }

  /**
   * Verifies the authenticity and integrity of a receipt payload.
   * Detects any tampering in payload, digest, status, or signature.
   */
  public static verifyReceipt(receipt: any): ReceiptVerificationResult {
    const tamperedFields: string[] = [];

    if (!receipt || typeof receipt !== "object") {
      return { valid: false, tamperedFields: ["envelope"], reason: "Malformed receipt" };
    }

    // Verify payload digest
    const computedDigest = this.computePayloadDigest(receipt.payload || {});
    if (computedDigest !== receipt.payloadDigest) {
      tamperedFields.push("payload");
      tamperedFields.push("payloadDigest");
    }

    // Verify cryptographic signature
    const expectedSignature = this.computeReceiptSignature({
      receiptId: receipt.receiptId,
      operationType: receipt.operationType,
      actor: receipt.actor || "",
      status: receipt.status,
      timestamp: receipt.timestamp,
      nonce: receipt.nonce,
      payloadDigest: receipt.payloadDigest,
      externalReferences: receipt.externalReferences || {},
    });

    if (expectedSignature !== receipt.signature) {
      tamperedFields.push("signature");
    }

    const valid = tamperedFields.length === 0;
    return {
      valid,
      tamperedFields,
      reason: valid ? undefined : `Receipt integrity verification failed on fields: ${tamperedFields.join(", ")}`,
    };
  }

  /**
   * Retrieves a receipt by ID with strict permission check.
   * Only the actor who owns the receipt or an authorized maintainer can access it.
   */
  public static async getReceiptById(
    receiptId: string,
    caller: { wallet?: string; isMaintainer?: boolean }
  ): Promise<{ receipt: ISignedReceipt; verification: ReceiptVerificationResult }> {
    const receipt = await SignedReceipt.findOne({ receiptId });
    if (!receipt) {
      throw new Error(`Receipt not found: ${receiptId}`);
    }

    const callerWallet = caller.wallet?.toLowerCase();
    const isOwner = callerWallet && callerWallet === receipt.actor.toLowerCase();

    if (!isOwner && !caller.isMaintainer) {
      throw new Error("Forbidden: You do not have permission to view this receipt.");
    }

    const verification = this.verifyReceipt(receipt);
    return { receipt, verification };
  }

  /**
   * Lists receipts belonging to an actor with optional filtering.
   */
  public static async listReceipts(
    actor: string,
    options?: {
      operationType?: CriticalOperationType;
      limit?: number;
      skip?: number;
    }
  ): Promise<{ receipts: ISignedReceipt[]; total: number }> {
    const query: Record<string, any> = { actor: actor.toLowerCase() };
    if (options?.operationType) {
      query.operationType = options.operationType;
    }

    const limit = Math.min(options?.limit || 20, 100);
    const skip = options?.skip || 0;

    const [receipts, total] = await Promise.all([
      SignedReceipt.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      SignedReceipt.countDocuments(query),
    ]);

    return { receipts, total };
  }
}
