import express, { Request, Response } from "express";
import connectDb from "../db/connectDb";
import { purchaseLimiter } from "../middleware/rateLimiter";
import { Bundle } from "../models/Bundle";
import { BundlePurchase } from "../models/BundlePurchase";
import {
  createBundle,
  purchaseBundle,
  recoverPartialBundleUnlock,
} from "../services/bundleService";

export const bundleRouter = express.Router();

/**
 * GET /api/bundles
 * List active prompt bundles.
 */
bundleRouter.get("/", async (req: Request, res: Response) => {
  try {
    await connectDb();
    const bundles = await Bundle.find({ status: "active" }).sort({ createdAt: -1 }).lean();
    return res.json({
      success: true,
      bundles,
    });
  } catch (err: any) {
    console.error("Fetch bundles error:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch bundles" });
  }
});

/**
 * GET /api/bundles/:id
 * Get bundle details by ID.
 */
bundleRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    await connectDb();
    const bundle = await Bundle.findById(req.params.id).lean();
    if (!bundle) {
      return res.status(404).json({ error: "Bundle not found" });
    }
    return res.json({
      success: true,
      bundle,
    });
  } catch (err: any) {
    console.error("Fetch bundle error:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch bundle" });
  }
});

/**
 * POST /api/bundles
 * Create a new prompt bundle with snapshots.
 */
bundleRouter.post("/", async (req: Request, res: Response) => {
  try {
    await connectDb();
    const { title, description, creatorAddress, promptIds, bundlePrice, discountPercent } = req.body;

    if (!title || !creatorAddress || !promptIds) {
      return res.status(400).json({ error: "title, creatorAddress, and promptIds are required" });
    }

    const bundle = await createBundle({
      title,
      description,
      creatorAddress,
      promptIds,
      bundlePrice: bundlePrice !== undefined ? Number(bundlePrice) : undefined,
      discountPercent: discountPercent !== undefined ? Number(discountPercent) : undefined,
    });

    return res.status(201).json({
      success: true,
      bundle,
    });
  } catch (err: any) {
    console.error("Create bundle error:", err);
    return res.status(400).json({ error: err.message || "Failed to create bundle" });
  }
});

/**
 * POST /api/bundles/:id/purchase
 * Purchase a bundle atomically.
 */
bundleRouter.post("/:id/purchase", purchaseLimiter, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const bundleId = req.params.id;
    const { buyerAddress, txHash, pricePaid } = req.body;

    if (!buyerAddress || !txHash) {
      return res.status(400).json({ error: "buyerAddress and txHash are required" });
    }

    const purchase = await purchaseBundle({
      buyerAddress,
      bundleId,
      txHash,
      pricePaid: pricePaid !== undefined ? Number(pricePaid) : undefined,
    });

    return res.json({
      success: true,
      purchase,
    });
  } catch (err: any) {
    console.error("Purchase bundle error:", err);
    return res.status(400).json({ error: err.message || "Failed to purchase bundle" });
  }
});

/**
 * POST /api/bundles/purchases/:purchaseId/recover
 * Recover partial unlock failure without double-charging.
 */
bundleRouter.post("/purchases/:purchaseId/recover", async (req: Request, res: Response) => {
  try {
    await connectDb();
    const { purchaseId } = req.params;
    const { buyerAddress } = req.body;

    if (!buyerAddress) {
      return res.status(400).json({ error: "buyerAddress is required" });
    }

    const purchase = await recoverPartialBundleUnlock(buyerAddress, purchaseId);
    return res.json({
      success: true,
      purchase,
    });
  } catch (err: any) {
    console.error("Recover bundle unlock error:", err);
    return res.status(400).json({ error: err.message || "Failed to recover bundle unlock" });
  }
});
