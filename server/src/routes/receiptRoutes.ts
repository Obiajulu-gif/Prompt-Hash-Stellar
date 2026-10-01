import express, { Request, Response } from "express";
import connectDb from "../db/connectDb";
import {
  SignedReceiptService,
  CreateReceiptParams,
} from "../services/signedReceiptService";
import { CriticalOperationType } from "../models/SignedReceipt";
import { requireIdempotency } from "../middleware/idempotency";

export const receiptRouter = express.Router();

/**
 * POST /api/receipts/verify
 * Public endpoint to verify integrity and cryptographic signature of a receipt.
 * Detects tampering in payload, digest, status, or envelope.
 */
receiptRouter.post("/verify", async (req: Request, res: Response) => {
  const receiptData = req.body.receipt || req.body;
  if (!receiptData || !receiptData.receiptId) {
    return res.status(400).json({
      success: false,
      error: "Receipt payload with receiptId is required for verification.",
    });
  }

  try {
    const result = SignedReceiptService.verifyReceipt(receiptData);
    return res.json({
      success: true,
      verification: result,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: (err as Error).message || "Verification processing failed",
    });
  }
});

/**
 * GET /api/receipts/:receiptId
 * Retrieve signed receipt by ID with permission checks.
 * Only the actor or maintainer/admin can access.
 */
receiptRouter.get("/:receiptId", async (req: Request, res: Response) => {
  const { receiptId } = req.params;
  const callerWallet =
    (req.headers["x-wallet-address"] as string) ||
    (req.query.walletAddress as string);
  const isAdmin =
    req.headers["x-admin-token"] !== undefined ||
    req.headers["authorization"]?.includes("admin");

  if (!receiptId) {
    return res.status(400).json({ error: "receiptId parameter is required" });
  }

  try {
    await connectDb();
    const result = await SignedReceiptService.getReceiptById(String(receiptId), {
      wallet: callerWallet,
      isMaintainer: Boolean(isAdmin),
    });

    return res.json({
      success: true,
      data: result.receipt,
      verification: result.verification,
    });
  } catch (err) {
    const message = (err as Error).message || "";
    if (message.includes("Forbidden")) {
      return res.status(403).json({ error: message });
    }
    if (message.includes("not found")) {
      return res.status(404).json({ error: message });
    }
    return res.status(500).json({ error: message || "Failed to retrieve receipt" });
  }
});

/**
 * GET /api/receipts
 * List signed receipts for a specific actor/wallet.
 */
receiptRouter.get("/", async (req: Request, res: Response) => {
  const callerWallet =
    (req.headers["x-wallet-address"] as string) ||
    (req.query.wallet as string) ||
    (req.query.walletAddress as string);

  if (!callerWallet) {
    return res.status(400).json({
      error: "walletAddress parameter or x-wallet-address header is required to list receipts",
    });
  }

  const operationType = req.query.operationType as CriticalOperationType | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const skip = req.query.skip ? Number(req.query.skip) : 0;

  try {
    await connectDb();
    const result = await SignedReceiptService.listReceipts(callerWallet, {
      operationType,
      limit,
      skip,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    return res.status(500).json({
      error: (err as Error).message || "Failed to list receipts",
    });
  }
});

/**
 * POST /api/receipts
 * Generate a new signed activity receipt.
 */
receiptRouter.post("/", requireIdempotency, async (req: Request, res: Response) => {
  const { operationType, actor, status, payload, externalReferences } = req.body;

  if (!operationType || !actor || !status || !payload) {
    return res.status(400).json({
      error: "Missing required fields: operationType, actor, status, and payload are required.",
    });
  }

  try {
    await connectDb();
    const receipt = await SignedReceiptService.createReceipt({
      operationType,
      actor,
      status,
      payload,
      externalReferences,
    });

    return res.status(201).json({
      success: true,
      data: receipt,
    });
  } catch (err) {
    return res.status(500).json({
      error: (err as Error).message || "Failed to create receipt",
    });
  }
});
