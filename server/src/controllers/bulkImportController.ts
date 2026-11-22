import { Request, Response } from "express";
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import {
  beginTransfer,
  responseAbortSignal,
  TransferCancelledError,
  TransferError,
  type TransferExecution,
} from "../services/transferExecution";
import type { AdminRequest } from "../middleware/adminAuth";
import Prompt from "../models/Prompt";
import { provenanceService } from "../services/provenanceService";
import { policyLimitService } from "../services/policyLimitService";
import { logger } from "../services/structuredLogger";
import { recordAuditEvent } from "../services/auditTrail";

/**
 * Bulk Import Controller (Issue #929)
 *
 * Provides endpoints for importing multiple prompts at once with full
 * provenance tracking for maintainers and administrators.
 */

interface BulkImportItem {
  title: string;
  content: string;
  description?: string;
  image: string;
  category: string;
  price: number;
  tags?: string[];
  externalId?: string;
  externalUrl?: string;
  sourceMetadata?: Record<string, any>;
}

interface BulkImportRequest {
  items: BulkImportItem[];
  batchName?: string;
  sourceSystem?: {
    systemName: string;
    systemVersion?: string;
    systemUrl?: string;
    apiEndpoint?: string;
  };
  dryRun?: boolean;
  transferId?: string;
}

interface BulkImportResult {
  batchId: string;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  imported: Array<{
    externalId?: string;
    promptId: string;
    provenanceId: string;
  }>;
  failed: Array<{
    externalId?: string;
    error: string;
    item: BulkImportItem;
  }>;
  status: "completed" | "partial" | "failed" | "cancelled";
  transferId?: string;
}

/**
 * POST /api/admin/prompts/bulk-import
 *
 * Import multiple prompts at once with provenance tracking.
 * Requires admin authentication.
 */
export async function bulkImportPrompts(
  req: Request,
  res: Response,
): Promise<Response> {
  let execution: TransferExecution | undefined;
  try {
    const admin = (req as AdminRequest).admin;
    const user =
      (req as any).user ||
      (admin ? { _id: admin.sub, role: "admin" } : undefined);
    const walletAddress = (req as any).walletAddress || user?.walletAddress;

    // Validate admin/maintainer permissions
    if (!user || (user.role !== "admin" && user.role !== "maintainer")) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Bulk import requires admin or maintainer role",
      });
    }

    const {
      items,
      batchName,
      sourceSystem,
      dryRun = false,
    }: BulkImportRequest = req.body;

    // Validate request
    if (
      !items ||
      !Array.isArray(items) ||
      items.length === 0 ||
      items.length > 1000
    ) {
      return res.status(400).json({
        error: "Invalid request",
        message: "items array must contain between 1 and 1000 entries",
      });
    }

    // Check policy limits
    const policyCheck = policyLimitService.evaluate({
      operation: "STORAGE_BULK_IMPORT",
      actor: { wallet: walletAddress, ip: req.ip },
      costOrSize: items.length,
    });

    if (!policyCheck.allowed) {
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: policyCheck.remediation,
        limit: policyCheck.limit,
        retryAfter: policyCheck.retryAfterSeconds,
      });
    }

    if (!dryRun && !mongoose.isValidObjectId(user._id)) {
      return res
        .status(400)
        .json({ error: "Import actor must reference a User ObjectId" });
    }
    execution = await beginTransfer(
      String(admin?.sub || user._id),
      "import",
      { items, batchName, sourceSystem, dryRun },
      req.body.transferId,
      responseAbortSignal(res),
    );
    res.setHeader("X-Transfer-Id", execution.id);
    const batchId = `batch_${execution.id}`;
    const batchStartTime = Date.now();

    logger.info("Starting bulk import", {
      batchId,
      itemCount: items.length,
      batchName,
      actorId: user._id,
      dryRun,
    });

    const result: BulkImportResult = {
      batchId,
      transferId: execution.id,
      totalItems: items.length,
      successfulItems: 0,
      failedItems: 0,
      imported: [],
      failed: [],
      status: "completed",
    };

    // Process each item
    for (const [index, item] of items.entries()) {
      try {
        await execution.check();
        // Validate item
        if (!item.title || !item.content || !item.image || !item.category) {
          throw new Error(
            "Missing required fields: title, content, image, category",
          );
        }

        if (dryRun) {
          // In dry-run mode, just validate without creating
          result.successfulItems++;
          result.imported.push({
            externalId: item.externalId,
            promptId: `dry-run-${index}`,
            provenanceId: `dry-run-prov-${index}`,
          });
          continue;
        }

        // Create prompt
        const promptId = createHash("sha256")
          .update(`${batchId}:${index}:prompt`)
          .digest("hex")
          .slice(0, 24);
        const prompt = await execution.step(`prompt_${index}`, promptId, () =>
          Prompt.findOneAndUpdate(
            { _id: promptId },
            {
              $setOnInsert: {
                title: item.title,
                content: item.content,
                description: item.description || "",
                image: item.image,
                category: item.category,
                price: item.price,
                tags: item.tags || [],
                owner: user._id,
                listingStatus: "draft", // Start as draft for review
                isActive: false,
              },
            },
            { upsert: true, new: true, runValidators: true },
          ),
        );

        // Create provenance record
        const provenanceRecord = await provenanceService.createProvenanceRecord(
          {
            promptId: prompt._id.toString(),
            recovery: {
              execution,
              index,
              provenanceId: createHash("sha256")
                .update(`${batchId}:${index}:provenance`)
                .digest("hex")
                .slice(0, 24),
            },
            sourceType: "file_upload",
            sourceSystem: sourceSystem || {
              systemName: "Bulk Import",
              systemVersion: "1.0.0",
            },
            importBatch: {
              batchId,
              batchName: batchName || `Bulk import ${new Date().toISOString()}`,
              totalItems: items.length,
              successfulItems: result.successfulItems,
              failedItems: result.failedItems,
              status: "processing",
              startedAt: new Date(batchStartTime),
            },
            actor: {
              actorType: user.role === "admin" ? "admin" : "user",
              actorId: user._id.toString(),
              actorName: user.username || user.displayName,
              actorWallet: walletAddress,
              actorEmail: user.email,
              actorRole: user.role,
              actorIp: req.ip,
              actorUserAgent: req.headers["user-agent"],
            },
            metadata: {
              externalId: item.externalId,
              externalUrl: item.externalUrl,
              sourceMetadata: item.sourceMetadata,
              importIndex: index,
              batchId,
            },
          },
        );

        result.successfulItems++;
        result.imported.push({
          externalId: item.externalId,
          promptId: prompt._id.toString(),
          provenanceId: provenanceRecord._id.toString(),
        });

        logger.debug("Imported prompt", {
          batchId,
          promptId: prompt._id,
          index,
        });
      } catch (error: any) {
        if (error instanceof TransferCancelledError) {
          result.status = "cancelled";
          break;
        }
        result.failedItems++;
        result.failed.push({
          externalId: item.externalId,
          error: error.message || "Unknown error",
          item,
        });

        logger.error("Failed to import prompt", {
          batchId,
          index,
          error: error.message,
        });
      }
    }

    // Update batch status
    const batchCompletedAt = new Date();
    result.status =
      result.status === "cancelled"
        ? "cancelled"
        : result.failedItems === 0
          ? "completed"
          : result.successfulItems > 0
            ? "partial"
            : "failed";

    // Update all provenance records with final batch status
    if (!dryRun) {
      const records = await provenanceService.queryProvenance({
        batchId,
        limit: items.length,
      });
      // Finalize already committed rows even after cancellation; this is
      // bookkeeping, never another imported prompt.
      for (const record of records) {
        if (record.importBatch) {
          record.importBatch.status =
            result.status === "cancelled" ? "partial" : result.status;
          record.importBatch.successfulItems = result.successfulItems;
          record.importBatch.failedItems = result.failedItems;
          record.importBatch.completedAt = batchCompletedAt;
          record.importBatch.errorSummary =
            result.failedItems > 0
              ? `${result.failedItems} items failed to import`
              : undefined;
          await execution.step(
            `finalize_${record._id}`,
            String(record._id),
            () => record.save(),
            { settlement: true },
          );
        }
      }
    }

    // Audit log
    await recordAuditEvent({
      action: "bulk_import_completed",
      result: result.status === "completed" ? "success" : "partial_success",
      actor: user._id.toString(),
      target: batchId,
      targetType: "bulk_import_batch",
      metadata: {
        totalItems: result.totalItems,
        successfulItems: result.successfulItems,
        failedItems: result.failedItems,
        durationMs: Date.now() - batchStartTime,
        dryRun,
      },
    });

    logger.info("Bulk import completed", {
      batchId,
      status: result.status,
      successfulItems: result.successfulItems,
      failedItems: result.failedItems,
      durationMs: Date.now() - batchStartTime,
    });

    try {
      await execution.check();
      await execution.finish(result.failedItems ? "failed" : "completed");
    } catch (err) {
      if (!(err instanceof TransferCancelledError)) throw err;
      result.status = "cancelled";
      await execution.finish("cancelled");
    }
    return res.status(result.status === "failed" ? 400 : 200).json({
      success: result.status === "completed" || result.status === "partial",
      result,
    });
  } catch (error: any) {
    if (execution)
      await execution.finish(
        error instanceof TransferCancelledError ? "cancelled" : "failed",
      );
    if (error instanceof TransferError)
      return res
        .status(error.status)
        .json({ error: error.message, transferId: execution?.id });
    logger.error("Bulk import error", {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}

/**
 * GET /api/admin/prompts/bulk-import/:batchId
 *
 * Get status and results of a bulk import batch.
 */
export async function getBulkImportStatus(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const { batchId } = req.params as Record<string, string>;

    const provenanceRecords = await provenanceService.queryProvenance({
      batchId,
      limit: 1000,
    });

    if (provenanceRecords.length === 0) {
      return res.status(404).json({
        error: "Not found",
        message: `Batch ${batchId} not found`,
      });
    }

    const firstRecord = provenanceRecords[0];
    const batch = firstRecord.importBatch;

    return res.status(200).json({
      batchId,
      batchName: batch?.batchName,
      status: batch?.status,
      totalItems: batch?.totalItems,
      successfulItems: batch?.successfulItems,
      failedItems: batch?.failedItems,
      startedAt: batch?.startedAt,
      completedAt: batch?.completedAt,
      errorSummary: batch?.errorSummary,
      items: provenanceRecords.map((record) => ({
        promptId: record.promptId,
        provenanceId: record._id,
        externalId: record.metadata?.externalId,
        createdAt: record.createdAt,
      })),
    });
  } catch (error: any) {
    logger.error("Failed to get bulk import status", {
      error,
      batchId: req.params.batchId,
    });

    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}

/**
 * GET /api/admin/prompts/bulk-import
 *
 * List all bulk import batches.
 */
export async function listBulkImports(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const { limit = 50, offset = 0, status } = req.query;

    const stats = await provenanceService.getImportStatistics({
      sourceType: "file_upload",
    });

    // Get unique batch IDs
    const allRecords = await provenanceService.queryProvenance({
      sourceType: "file_upload",
      limit: Number(limit) * 10, // Over-fetch to get distinct batches
    });

    const batchMap = new Map();
    allRecords.forEach((record) => {
      const batchId = record.importBatch?.batchId;
      if (batchId && !batchMap.has(batchId)) {
        batchMap.set(batchId, {
          batchId,
          batchName: record.importBatch.batchName,
          status: record.importBatch.status,
          totalItems: record.importBatch.totalItems,
          successfulItems: record.importBatch.successfulItems,
          failedItems: record.importBatch.failedItems,
          startedAt: record.importBatch.startedAt,
          completedAt: record.importBatch.completedAt,
          actorId: record.actor.actorId,
          actorName: record.actor.actorName,
        });
      }
    });

    const batches = Array.from(batchMap.values())
      .filter((batch) => !status || batch.status === status)
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      )
      .slice(Number(offset), Number(offset) + Number(limit));

    return res.status(200).json({
      batches,
      total: batchMap.size,
      limit: Number(limit),
      offset: Number(offset),
      stats,
    });
  } catch (error: any) {
    logger.error("Failed to list bulk imports", { error });

    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}
