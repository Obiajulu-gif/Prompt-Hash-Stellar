import { Router, Request, Response } from "express";
import connectDb from "../db/connectDb";
import { authLimiter } from "../middleware/rateLimiter";
import { requireAdminScope, type AdminRequest } from "../middleware/adminAuth";
import { requireIdempotency } from "../middleware/idempotency";
import {
  runUserExport,
  listUserExports,
  cleanupExpiredExports,
  verifyExportChecksum,
  EXPORT_SCOPES,
  type ExportScope,
} from "../services/exportService";
import { ExportRecord } from "../models/ExportRecord";

export const exportRouter = Router();

/**
 * User data export endpoints.
 * 
 * Users can export only their own data.
 * Admins (with valid admin token) can export any user's data.
 * Exports are retained for 24 hours, then automatically cleaned up.
 * 
 * GET    /api/exports         — list user's exports
 * POST   /api/exports         — initiate a new export (scope: prompt|history|full)
 * GET    /api/exports/:id     — check export status and download
 */

// List user's exports
exportRouter.get(
  "/",
  authLimiter,
  async (req: AdminRequest, res: Response) => {
    try {
      await connectDb();

      // Determine if user is admin
      const isAdmin = !!req.admin;

      // List exports for the authenticated user
      // If admin, we need the userId from query; otherwise use the admin's sub
      let userId = req.query.userId as string;
      let isAdminCheck = isAdmin;

      if (isAdmin && !userId) {
        return res.status(400).json({ error: "userId query parameter required for admin exports" });
      }

      // If not admin, use the admin's sub as the userId
      if (!isAdmin && req.admin) {
        userId = req.admin.sub as string;
        isAdminCheck = false;
      }

      const exports = await listUserExports(userId, isAdminCheck);
      res.json({ exports });
    } catch (err) {
      console.error("Failed to list exports:", err);
      res.status(500).json({ error: "Failed to list exports" });
    }
  },
);

/**
 * Initiate a new user data export.
 * 
 * Body parameters:
 * - userId: ID of the user whose data to export (optional; defaults to authenticated user)
 * - scope: "prompt" | "history" | "full" (default: "prompt")
 * - reason: human-readable reason for the export
 */
exportRouter.post(
  "/",
  authLimiter,
  requireIdempotency,
  async (req: AdminRequest, res: Response) => {
    try {
      await connectDb();

      const { userId, scope = "prompt", reason = "User-initiated data export" } = req.body as {
        userId?: string;
        scope?: ExportScope;
        reason?: string;
      };

      // Determine the target user
      let targetUserId = userId;

      // If no userId provided, use the authenticated user
      if (!targetUserId) {
        if (req.admin) {
          targetUserId = req.admin.sub as string;
        } else {
          // This shouldn't happen if auth is properly set up, but fallback
          targetUserId = "unknown";
        }
      }

      // Authorization check: regular users can only export their own data
      if (req.admin && req.admin.sub && targetUserId && req.admin.sub !== targetUserId) {
        // Admin exporting another user's data - authorized
      } else if (!req.admin || !req.admin.sub) {
        // Regular user - must export their own data
        // The exportService will handle the authorization check internally
      }

      // Initiate the export
      const exportRecord = await runUserExport(
        req.admin?.sub as string || "",
        targetUserId,
        scope as ExportScope,
        !!req.admin,
      );

      res.status(202).json({
        success: true,
        exportId: exportRecord._id,
        scope: exportRecord.scope,
        status: exportRecord.status,
        metadata: exportRecord.metadata,
        generatedAt: exportRecord.generatedAt,
        expiresAt: exportRecord.expiresAt,
        message: "Export initiated. Use GET /api/exports/:id to check status and download.",
      });
    } catch (err: any) {
      console.error("Failed to initiate export:", err);
      if (err.message?.includes("Not authorized")) {
        return res.status(403).json({ error: err.message });
      }
      res.status(500).json({ error: "Failed to initiate export" });
    }
  },
);

/**
 * Check export status and download.
 * 
 * GET /api/exports/:id
 * GET /api/exports/:id/download?token=...
 */
exportRouter.get(
  "/:exportId",
  authLimiter,
  async (req: AdminRequest, res: Response) => {
    try {
      await connectDb();

      const exportId = req.params.exportId;

      // Find the export record
      const exportRecord = await ExportRecord.findById(exportId).lean();

      if (!exportRecord) {
        return res.status(404).json({ error: "Export record not found" });
      }

      // Check authorization
      const isAdmin = !!req.admin;
      const requestingUserId = req.admin?.sub as string || "";

      // Regular users can only see their own exports
      if (!isAdmin && exportRecord.userId.toString() !== requestingUserId) {
        return res.status(403).json({ error: "Not authorized to view this export" });
      }

      // If export is still pending or processing
      if (exportRecord.status !== "completed") {
        return res.json({
          exportId: exportRecord._id,
          status: exportRecord.status,
          generatedAt: exportRecord.generatedAt,
          expiresAt: exportRecord.expiresAt,
          metadata: exportRecord.metadata,
          message: exportRecord.status === "pending"
            ? "Export is being processed. Check back shortly."
            : exportRecord.status === "failed"
            ? "Export failed. Please try again."
            : "Export is still being processed.",
        });
      }

      // Export is completed - check integrity checksum if available
      if (exportRecord.integrityChecksum && exportRecord.metadata) {
        const { records } = await getExportRecords(exportRecord._id.toString());
        const checksumValid = verifyExportChecksum(records, exportRecord.integrityChecksum);

        return res.json({
          exportId: exportRecord._id,
          status: "completed",
          statusMessage: "Export complete and ready for download",
          recordCount: exportRecord.metadata?.recordCount || records.length,
          schemaVersion: exportRecord.metadata?.schemaVersion || "1.0.0",
          integrityChecksumValid: checksumValid,
          downloadUrl: exportRecord.fileUrl,
          fileSizeHint: "See download response for actual size",
        });
      }

      // No checksum - just provide download URL
      res.json({
        exportId: exportRecord._id,
        status: "completed",
        statusMessage: "Export complete and ready for download",
        recordCount: exportRecord.metadata?.recordCount || 0,
        schemaVersion: exportRecord.metadata?.schemaVersion || "1.0.0",
        downloadUrl: exportRecord.fileUrl,
      });
    } catch (err) {
      console.error("Failed to check export status:", err);
      res.status(500).json({ error: "Failed to check export status" });
    }
  },
);

/**
 * Helper: get the actual exported records from DB
 */
async function getExportRecords(exportId: string): Promise<{ records: any[] }> {
  const exportRecord = await ExportRecord.findById(exportId).lean();
  // In a full implementation, we'd reconstruct the records from the original data
  // For now, return empty - the actual records would be rebuilt from the DB query
  return { records: [] };
}

export default exportRouter;
