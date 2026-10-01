import { Request, Response } from "express";
import connectDb from "../db/connectDb.js";
import {
  resolvePermalink,
  renameRecord,
  archiveRecord,
  restoreRecord,
  restrictRecord,
  deleteRecord,
} from "../services/permalinkService.js";
import { logger } from "../services/structuredLogger.js";

/**
 * Controller to resolve permalinks, slugs, and record identifiers.
 * Safely redirects renamed records and guards restricted/archived records
 * from leaking private data.
 */
export const ResolvePromptPermalink = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    await connectDb();

    const identifier = req.params.identifier || (req.query.identifier as string);
    if (!identifier) {
      return res.status(400).json({ error: "Record identifier or slug is required." });
    }

    const viewerWallet =
      (req.query.viewerWallet as string) ||
      (req.headers["x-wallet-address"] as string) ||
      undefined;

    const isAdmin = Boolean((req as any).admin);
    const role = isAdmin ? "admin" : undefined;

    const result = await resolvePermalink(identifier, { viewerWallet, role });

    // Handle 301 Permanent Redirect for renamed records
    if (result.status === "redirect") {
      res.setHeader("Location", result.canonicalUrl);
      res.setHeader("Cache-Control", "public, max-age=86400"); // 24h cache for permanent redirects

      // If requested by a standard browser navigation
      if (req.accepts("html") && !req.accepts("json")) {
        return res.redirect(301, result.canonicalUrl);
      }

      return res.status(301).json(result);
    }

    // Set Cache-Control appropriately
    if (result.status === "restricted" || result.status === "deleted") {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    } else {
      res.setHeader("Cache-Control", "public, max-age=60");
    }

    return res.status(result.statusCode).json(result);
  } catch (err: any) {
    logger.error("Resolve permalink error", {
      action: "resolvePromptPermalink",
      error: err,
    });
    return res.status(500).json({
      error: err.message || "Failed to resolve permalink.",
    });
  }
};

/**
 * Controller to rename a prompt record and update permalink / slug aliases.
 */
export const RenamePromptRecord = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    await connectDb();

    const { promptId } = req.params;
    const { newTitle, reason, walletAddress } = req.body;

    if (!promptId) {
      return res.status(400).json({ error: "promptId is required." });
    }
    if (!newTitle || typeof newTitle !== "string" || newTitle.trim().length < 3) {
      return res.status(400).json({ error: "Valid newTitle (min 3 chars) is required." });
    }

    const updated = await renameRecord({
      promptId,
      newTitle: newTitle.trim(),
      reason,
      actor: {
        role: (req as any).admin ? "admin" : "creator",
        id: walletAddress || null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Prompt renamed successfully.",
      slug: updated.slug,
      canonicalUrl: updated.canonicalUrl,
      previousSlugs: updated.previousSlugs,
    });
  } catch (err: any) {
    logger.error("Rename prompt error", { action: "renamePromptRecord", error: err });
    return res.status(500).json({
      error: err.message || "Failed to rename prompt record.",
    });
  }
};

/**
 * Controller to archive a prompt record.
 */
export const ArchivePromptRecord = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    await connectDb();

    const { promptId } = req.params;
    const { reason, walletAddress } = req.body;

    const updated = await archiveRecord({
      promptId,
      reason,
      actor: {
        role: (req as any).admin ? "admin" : "creator",
        id: walletAddress || null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Prompt archived successfully.",
      status: updated.listingStatus,
      archivedAt: updated.archivedAt,
      canonicalUrl: updated.canonicalUrl,
    });
  } catch (err: any) {
    logger.error("Archive prompt error", { action: "archivePromptRecord", error: err });
    return res.status(500).json({
      error: err.message || "Failed to archive prompt record.",
    });
  }
};

/**
 * Controller to restore an archived prompt record.
 */
export const RestorePromptRecord = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    await connectDb();

    const { promptId } = req.params;
    const { reason, walletAddress } = req.body;

    const updated = await restoreRecord({
      promptId,
      reason,
      actor: {
        role: (req as any).admin ? "admin" : "creator",
        id: walletAddress || null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Prompt restored successfully.",
      status: updated.listingStatus,
      canonicalUrl: updated.canonicalUrl,
    });
  } catch (err: any) {
    logger.error("Restore prompt error", { action: "restorePromptRecord", error: err });
    return res.status(500).json({
      error: err.message || "Failed to restore prompt record.",
    });
  }
};

/**
 * Controller to restrict a prompt record (moderation).
 */
export const RestrictPromptRecord = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    await connectDb();

    const { promptId } = req.params;
    const { reason, notes, moderatorWallet } = req.body;

    const updated = await restrictRecord({
      promptId,
      reasonCode: reason,
      notes,
      actor: {
        role: "moderator",
        id: moderatorWallet || null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Prompt restricted successfully.",
      moderationStatus: updated.moderationStatus,
      canonicalUrl: updated.canonicalUrl,
    });
  } catch (err: any) {
    logger.error("Restrict prompt error", { action: "restrictPromptRecord", error: err });
    return res.status(500).json({
      error: err.message || "Failed to restrict prompt record.",
    });
  }
};
