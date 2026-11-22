import connectDb from "../db/connectDb";
import { ExportRecord, type IExportRecord } from "../models/ExportRecord";
import Prompt from "../models/Prompt";
import { beginTransfer, TransferCancelledError } from "./transferExecution";
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

export type ExportScope = (typeof EXPORT_SCOPES)[keyof typeof EXPORT_SCOPES];

/**
 * Export retention: exports are valid for 24 hours after generation.
 */
export const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

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
function buildExportPrompt(prompt: any, isSelfExport: boolean): any {
  return {
    _id: prompt._id,
    onChainId: prompt.onChainId,
    title: prompt.title,
    category: prompt.category,
    isActive: prompt.isActive,
    price: prompt.price,
    // Include wallet hash instead of raw address for privacy
    ownerWalletHash: prompt.owner
      ? hashWalletAddress(String(prompt.owner))
      : null,
    // Preserve upstream field-level authorization: cross-user admin exports
    // omit contentHash; only the owner can export it for integrity checks.
    ...(isSelfExport ? { contentHash: prompt.contentHash ?? null } : {}),
    // Always exclude encryptedPrompt and full description.
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
    lifecycleState: prompt.lifecycleState,
  };
}

/**
 * Build a history entry for export.
 * Includes lifecycle events without exposing sensitive data.
 */
function buildExportHistoryEntry(prompt: any, event: any): any {
  return {
    promptId: prompt._id,
    event: event.to ?? event.action,
    result: event.from ?? event.result,
    timestamp: event.at ?? event.createdAt,
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
  options: {
    transferId?: string;
    signal?: AbortSignal;
    onStarted?: (id: string) => void;
  } = {},
): Promise<IExportRecord> {
  const userIdToExport = targetUserId || requestingUserId;
  if (
    !requestingUserId ||
    !(await isAuthorizedForExport(requestingUserId, userIdToExport, isAdmin))
  ) {
    throw Object.assign(
      new Error("Not authorized to export this user's data"),
      { status: 403 },
    );
  }
  if (!Object.values(EXPORT_SCOPES).includes(scope)) {
    throw Object.assign(new Error("Invalid export scope"), { status: 400 });
  }
  await connectDb();
  const execution = await beginTransfer(
    requestingUserId,
    "export",
    { userIdToExport, scope },
    options.transferId,
    options.signal,
  );
  options.onStarted?.(execution.id);
  // Stable artifact identity makes creation/retry safe after a lost DB reply.
  const exportId = execution.id;
  try {
    const now = new Date();
    const exportRecord = await execution.step("artifact", exportId, () =>
      ExportRecord.findOneAndUpdate(
        { _id: exportId },
        {
          $setOnInsert: {
            userId: userIdToExport,
            scope,
            status: "pending",
            generatedAt: now,
            expiresAt: new Date(now.getTime() + EXPORT_RETENTION_MS),
            metadata: {
              schemaVersion: "1.0.0",
              recordCount: 0,
              includeWalletHashes: true,
              includeHistory: scope !== "prompt",
            },
            auditTrail: {
              action: "user_export_initiated",
              performedBy: requestingUserId,
              reason: `Export request for scope=${scope}`,
            },
          },
        },
        { upsert: true, new: true, runValidators: true },
      ),
    );
    if (exportRecord.expiresAt <= now)
      throw new Error("Export expired; create a new transfer");
    const records = await collectExportRecords(
      userIdToExport, scope, requestingUserId === userIdToExport, () => execution.check(),
    );
    const downloadUrl = `/api/exports/${exportId}/download`;
    const completed = await execution.step("publish", exportId, () =>
      ExportRecord.findByIdAndUpdate(
        exportId,
        {
          $set: {
            status: "completed",
            fileUrl: downloadUrl,
            integrityChecksum: exportChecksum(records),
            "metadata.recordCount": records.length,
          },
        },
        { new: true },
      ),
    );
    await execution.finish("completed");
    return completed as IExportRecord;
  } catch (err) {
    const cancelled = err instanceof TransferCancelledError;
    // Never publish an artifact after cancellation/failure. No physical object
    // storage exists in this service; future adapters must delete temp objects.
    await ExportRecord.updateOne(
      { _id: exportId },
      {
        $set: {
          status: cancelled ? "cancelled" : "failed",
          "metadata.recordCount": 0,
        },
        $unset: { fileUrl: "", integrityChecksum: "" },
      },
    );
    await execution.finish(cancelled ? "cancelled" : "failed");
    throw err;
  }
}

export async function collectExportRecords(
  userId: string,
  scope: ExportScope,
  isSelfExport: boolean,
  check?: () => Promise<void>,
): Promise<unknown[]> {
  const records: any[] = [];
  // Cursor avoids loading the entire source collection before cancellation
  // can be observed. It is closed on success, failure and cancellation.
  const cursor = Prompt.find({ owner: userId })
    .select(
      "_id onChainId title category isActive price owner createdAt updatedAt lifecycleState lifecycleHistory" +
        (isSelfExport ? " contentHash" : ""),
    )
    .sort({ _id: 1 })
    .lean()
    .cursor();
  try {
    for await (const prompt of cursor) {
      await check?.();
      if (scope !== "history")
        records.push(buildExportPrompt(prompt, isSelfExport));
      if (scope !== "prompt") {
        records.push(
          ...(prompt.lifecycleHistory ?? [])
            .slice(0, 100)
            .map((event: any) => buildExportHistoryEntry(prompt, event)),
        );
      }
    }
  } finally {
    await cursor.close();
  }
  await check?.();
  return records;
}

export function mayDownloadExport(
  record: { userId: unknown; auditTrail?: { performedBy?: string } },
  requester: string,
): boolean {
  if (!requester || !record.auditTrail?.performedBy) return false;
  const owner = String(record.userId);
  return record.auditTrail.performedBy !== owner || requester === owner;
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
    status: { $in: ["completed", "failed", "cancelled", "expired"] },
  });

  return result.deletedCount;
}

export default {
  runUserExport,
  listUserExports,
  cleanupExpiredExports,
  verifyExportChecksum,
  EXPORT_SCOPES,
  EXPORT_RETENTION_MS,
};
