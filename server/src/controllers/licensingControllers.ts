import { Request, Response } from "express";
import LicenseTemplate from "../models/LicenseTemplate";
import connectDb from "../db/connectDb";
import { markPrivate } from "../middleware/etag";
import {
  getPurchaseReceipt,
  getLicenseSnapshotForDispute,
  resolveCurrentLicense,
  updatePromptLicense,
} from "../services/licensingService";

/**
 * Public catalog of license templates creators can adopt (#759).
 */
export const GetLicenseTemplates = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const templates = await LicenseTemplate.find({ active: true })
      .sort({ key: 1, version: -1 })
      .lean();
    return res.json({ templates });
  } catch (err) {
    console.error("Get license templates error:", err);
    return res.status(500).json({ error: "Failed to fetch license templates" });
  }
};

/**
 * Creator updates the license attached to their prompt (#759).
 * Body: { promptId, walletAddress, templateKey?, templateVersion?, summary?,
 *         termsText?, allowedUses?, commercialUse?, attributionRequired?,
 *         redistributionAllowed?, customTerms? }
 * Material changes bump the prompt's licenseVersionIndex; historical
 * purchases are never mutated.
 */
export const UpdatePromptLicense = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const result = await updatePromptLicense({
      promptId: String(req.body?.promptId ?? ""),
      actingWallet: String(req.body?.walletAddress ?? ""),
      templateKey: req.body?.templateKey,
      templateVersion: req.body?.templateVersion,
      summary: req.body?.summary,
      termsText: req.body?.termsText,
      allowedUses: Array.isArray(req.body?.allowedUses)
        ? req.body.allowedUses.map(String)
        : undefined,
      commercialUse: req.body?.commercialUse,
      attributionRequired: req.body?.attributionRequired,
      redistributionAllowed: req.body?.redistributionAllowed,
      customTerms: req.body?.customTerms,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json({ license: result.license });
  } catch (err) {
    console.error("Update prompt license error:", err);
    return res.status(500).json({ error: "Failed to update prompt license" });
  }
};

/**
 * Current license terms advertised for a prompt (#759).
 */
export const GetPromptLicense = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const { promptId } = req.params;
    if (!promptId) {
      return res.status(400).json({ error: "promptId is required." });
    }
    const license = await resolveCurrentLicense(promptId);
    return res.json({ license });
  } catch (err) {
    console.error("Get prompt license error:", err);
    return res.status(500).json({ error: "Failed to fetch prompt license" });
  }
};

/**
 * Buyer receipt with the license terms frozen at purchase time (#759).
 * markPrivate: receipts are wallet-scoped personal data.
 */
export const GetPurchaseReceipt = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    markPrivate(res);
    const { walletAddress, promptId } = req.params;
    const result = await getPurchaseReceipt(promptId, walletAddress);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json(result.receipt);
  } catch (err) {
    console.error("Get purchase receipt error:", err);
    return res.status(500).json({ error: "Failed to fetch purchase receipt" });
  }
};

/**
 * Admin dispute view (#759): frozen snapshot + the prompt's current terms
 * side by side, so a reviewer can see what changed after the purchase.
 */
export const GetLicenseDisputeView = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const { walletAddress, promptId } = req.params;
    const result = await getLicenseSnapshotForDispute(promptId, walletAddress);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json(result.dispute);
  } catch (err) {
    console.error("Get license dispute view error:", err);
    return res.status(500).json({ error: "Failed to fetch license dispute view" });
  }
};
