import connectDb from "../db/connectDb";
import { ExportRecord, type IExportRecord } from "../models/ExportRecord";
import Prompt from "../models/Prompt";
import User from "../models/User";
import { hashWalletAddress } from "../services/auditTrail";
import crypto from "crypto";

/**
 * Export scope definitions - what record types are included in each export mode.
 */
export const EXPORT_SCOPES = {
  PROMPT: "prompt",
  HISTORY: "history",
  FULL: "full",
} as const;

export type ExportScope = keyof typeof EXPORT_SCOPES;

/**
 * Export retention: exports are valid for 24 hours after generation.
 */
export const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Generate a signed download URL for an export.
 * In production, this would use a signed URL service (e.g., S3 CloudFront).
 * For now, returns a simple path with a time-limited token.
 */
function generateDownloadUrl(exportId: string, expiresAt: Date): string {
  const token = crypto
    .createHash("sha256")
    .update(exportId + Date.now().toString())
    .digest("hex");
  return `/api/exports/${exportId}/download?token=${token}&exp=${Math.floor(
    expiresAt.getTime() / 1000,
  )}`;
}

/**
 * Check if a user is authorized to export another user's data.
 * Regular users can only export their own data.
 * Admin users (with admin token) can export any user's data.
 */
async function isAuthorizedForExport(
  requestingUserId: string,
  targetUserId: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) {
    return true;
  }
  // Regular users can only export their own data
  return requestingUserId === targetUserId;
}

/**
 * Build a privacy-safe export record for a prompt.
 * Wallet addresses are hashed; raw sensitive data is excluded.
 */
function buildExportPrompt(prompt: any): any {
  return {
    _id: prompt._id,
    onChainId: prompt.onChainId,
    title: prompt.title,
    category: prompt.category,
    isActive: prompt.isActive,
    price: prompt.price,
    // Include wallet hash instead of raw address for privacy
    ownerWalletHash: prompt.owner ? hashWalletAddress(String(prompt.owner)) : null,
    // Exclude sensitive fields: encryptedPrompt, contentHash (if sensitive), full description
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
    lifecycleState: prompt.lifecycleState,
  };
}

/**
 * Build a history entry for export.
 * Includes lifecycle events without exposing sensitive data.
 */
function buildExportHistoryEntry(
  prompt: any,
  event: any,
): any {
  return {
    promptId: prompt._id,
    event: event.action,
    result: event.result,
    timestamp: event.createdAt,
    // Wallet hash for privacy (may be null if event doesn't involve a wallet)
    walletHash: event.walletHash ?? null,
    lifecycleState: prompt.lifecycleState,
  };
}

/**
 * Run a user-owned data export.
 * 
 * @param requestingUserId - ID of the user requesting the export
 * @param targetUserId - ID of the user whose data to export (defaults to requesting user)
 * @param scope - export scope: "prompt", "history", or "full"
 * @param isAdmin - whether the requesting user is an admin
 * @returns ExportRecord object
 */
export async function runUserExport(
  requestingUserId: string,
  targetUserId?: string,
  scope: ExportScope = "prompt",
  isAdmin = false,
): Promise<IExportRecord> {
  await connectDb();

  // Determine the target user ID
  const userIdToExport = targetUserId || requestingUserId;

  // Authorization check
  const authorized = await isAuthorizedForExport(
    requestingUserId,
    userIdToExport,
    isAdmin,
  );

  if (!authorized) {
    const error = new Error("Not authorized to export this user's data");
    error.status = 403;
    throw error;
  }

  // Create export record
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPORT_RETENTION_MS);

  const exportRecord = await ExportRecord.create({
    userId: userIdToExport,
    scope,
    status: "pending",
    generatedAt: now,
    expiresAt,
    metadata: {
      schemaVersion: "1.0.0",
      recordCount: 0,
      includeWalletHashes: scope !== "prompt" || true, // prompt scope always includes hashes
      includeHistory: scope === "history" || scope === "full",
    },
    auditTrail: {
      action: "user_export_initiated",
      performedBy: requestingUserId,
      reason: `Export request for scope=${scope} user=${userIdToExport}`,
    },
  });

  // Fetch the appropriate data based on scope
  let records: any[] = [];
  let recordCount = 0;

  try {
    if (scope === "prompt") {
      // Export only prompts owned by this user
      const prompts = await Prompt.find({ owner: userIdToExport })
        .select(
          "onChainId title category isActive price owner createdAt updatedAt lifecycleState",
        )
        .lean();

      records = prompts.map(buildExportPrompt);
      recordCount = records.length;

      // Update export record with results
      await ExportRecord.findByIdAndUpdate(exportRecord._id, {
        $set: {
          status: "completed",
          metadata: {
            ...exportRecord.metadata,
            recordCount,
          },
        },
        $set: {
          integrityChecksum: exportChecksum(records),
        },
      });
    } else if (scope === "history") {
      // Export prompt history/lifecycle events
      // Fetch prompts first, then their history
      const prompts = await Prompt.find({ owner: userIdToExport })
        .select("_id lifecycleHistory")
        .lean();

      records = [];
      recordCount = 0;

      for (const prompt of prompts) {
        if (prompt.lifecycleHistory && prompt.lifecycleHistory.length > 0) {
          const historyEntries = prompt.lifecycleHistory
            .slice(0, 100) // Limit per prompt to avoid huge exports
            .map((event: any) => buildExportHistoryEntry(prompt, event));

          records.push(...historyEntries);
          recordCount += historyEntries.length;
        }
      }

      // Update export record
      await ExportRecord.findByIdAndUpdate(exportRecord._id, {
        $set: {
          status: "completed",
          metadata: {
            ...exportRecord.metadata,
            recordCount,
            includeHistory: true,
          },
        },
        $set: {
          integrityChecksum: exportChecksum(records),
        },
      });
    } else if (scope === "full") {
      // Export prompts + full history + metadata
      const prompts = await Prompt.find({ owner: userIdToExport })
        .select(
          "_id onChainId title category isActive price owner " +
            "createdAt updatedAt lifecycleState lifecycleHistory",
        )
        .lean();

      records = [];
      recordCount = 0;

      for (const prompt of prompts) {
        // Export prompt data
        const promptData = buildExportPrompt(prompt);
        records.push(promptData);
        recordCount += 1;

        // Export history entries
        if (prompt.lifecycleHistory && prompt.lifecycleHistory.length > 0) {
          const historyEntries = prompt.lifecycleHistory
            .slice(0, 100)
            .map((event: any) => buildExportHistoryEntry(prompt, event));

          records.push(...historyEntries);
          recordCount += historyEntries.length;
        }
      }

      // Update export record
      await ExportRecord.findByIdAndUpdate(exportRecord._id, {
        $set: {
          status: "completed",
          metadata: {
            ...exportRecord.metadata,
            recordCount,
            includeHistory: true,
          },
        },
        $set: {
          integrityChecksum: exportChecksum(records),
        },
      });
    }

    // Generate download URL
    const downloadUrl = generateDownloadUrl(
      exportRecord._id.toString(),
      exportRecord.expiresAt,
    );

    // Update with download URL
    await ExportRecord.findByIdAndUpdate(exportRecord._id, {
      $set: {
        fileUrl: downloadUrl,
      },
    });

    return {
      ...exportRecord.toObject(),
      fileUrl: downloadUrl,
    } as IExportRecord;
  } catch (err) {
    // Mark export as failed
    await ExportRecord.findByIdAndUpdate(exportRecord._id, {
      $set: {
        status: "failed",
      },
    });

    throw err;
  }
}

/**
 * Generate a SHA-256 checksum of exported records for integrity verification.
 */
function exportChecksum(records: any[]): string {
  const hash = crypto.createHash("sha256");
  for (const record of records) {
    // Canonical JSON with sorted keys for deterministic checksum
    const canonical = JSON.stringify(record, Object.keys(record).sort());
    hash.update(canonical);
    hash.update("\n");
  }
  return hash.digest("hex");
}

/**
 * Verify an exported bundle's integrity checksum.
 */
export function verifyExportChecksum(
  records: any[],
  checksum: string,
): boolean {
  return exportChecksum(records) === checksum;
}

/**
 * List exports for a user (or admin can list all).
 */
export async function listUserExports(
  userId: string,
  isAdmin = false,
  limit = 10,
): Promise<IExportRecord[]> {
  await connectDb();

  const filter: any = { userId };
  if (!isAdmin) {
    // Non-admin can only see their own exports
    // This is handled by the caller ensuring the right userId
  }

  return ExportRecord.find(filter)
    .sort({ generatedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Clean up expired exports (should be run as a scheduled job).
 */
export async function cleanupExpiredExports(): Promise<number> {
  await connectDb();

  const result = await ExportRecord.deleteMany({
    expiresAt: { $lt: new Date() },
    status: { $ne: "expired" },
  });

  return result.deletedCount;
}

export default { runUserExport, listUserExports, cleanupExpiredExports, verifyExportChecksum, EXPORT_SCOPES, EXPORT_RETENTION_MS };
