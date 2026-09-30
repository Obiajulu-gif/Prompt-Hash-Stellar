import ProvenanceRecord, {
  ImportSourceType,
  TransformType,
  IImportBatch,
  ISourceSystem,
  ITransformMetadata,
  IActorMetadata,
} from "../models/ProvenanceRecord";
import Prompt from "../models/Prompt";
import PromptRelation from "../models/PromptRelation";
import { logger } from "./structuredLogger";
import { recordAuditEvent } from "./auditTrail";

/**
 * Provenance Service - manages provenance tracking for prompts (Issue #929).
 *
 * This service provides functions to:
 * - Create provenance records for imported/created prompts
 * - Track transformations applied to prompts
 * - Query provenance lineage
 * - Export provenance data for audit/compliance
 */

export interface CreateProvenanceParams {
  promptId: string;
  onChainId?: string;
  sourceType: ImportSourceType;
  sourceSystem: ISourceSystem;
  importBatch?: Partial<IImportBatch>;
  transformations?: Partial<ITransformMetadata>[];
  actor: IActorMetadata;
  parentProvenanceId?: string;
  sourcePromptId?: string;
  metadata?: Record<string, any>;
}

export interface UpdateTransformationParams {
  provenanceId: string;
  transformation: ITransformMetadata;
}

export interface QueryProvenanceParams {
  promptId?: string;
  batchId?: string;
  actorId?: string;
  sourceType?: ImportSourceType;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  includeDeleted?: boolean;
}

export interface ProvenanceExport {
  promptId: string;
  onChainId?: string;
  sourceType: string;
  sourceSystem: ISourceSystem;
  importBatch?: Partial<IImportBatch>;
  transformations: ITransformMetadata[];
  actor: IActorMetadata;
  parentProvenanceId?: string;
  lineageDepth: number;
  createdAt: Date;
  updatedAt: Date;
}

class ProvenanceService {
  /**
   * Create a new provenance record for a prompt.
   */
  async createProvenanceRecord(params: CreateProvenanceParams): Promise<any> {
    try {
      const {
        promptId,
        onChainId,
        sourceType,
        sourceSystem,
        importBatch,
        transformations,
        actor,
        parentProvenanceId,
        sourcePromptId,
        metadata,
      } = params;

      // Validate prompt exists
      const prompt = await Prompt.findById(promptId);
      if (!prompt) {
        throw new Error(`Prompt not found: ${promptId}`);
      }

      // Validate parent provenance if specified
      if (parentProvenanceId) {
        const parentProvenance = await ProvenanceRecord.findById(parentProvenanceId);
        if (!parentProvenance) {
          throw new Error(`Parent provenance record not found: ${parentProvenanceId}`);
        }
      }

      // Create provenance record
      const provenanceRecord = new ProvenanceRecord({
        promptId,
        onChainId,
        sourceType,
        sourceSystem,
        importBatch: importBatch || null,
        transformations: transformations || [],
        actor,
        parentProvenanceId: parentProvenanceId || null,
        sourcePromptId: sourcePromptId || null,
        metadata: metadata || {},
        verificationStatus: "unverified",
      });

      await provenanceRecord.save();

      // Update prompt with provenance reference
      await Prompt.findByIdAndUpdate(promptId, {
        provenanceSource: sourceType,
        provenanceBatchId: importBatch?.batchId || null,
        provenanceActorId: actor.actorId,
        provenanceRecordId: provenanceRecord._id,
        hasProvenance: true,
      });

      // Audit log
      await recordAuditEvent({
        action: "provenance_record_created",
        result: "success",
        actor: actor.actorId,
        target: promptId,
        targetType: "prompt",
        metadata: {
          provenanceId: provenanceRecord._id.toString(),
          sourceType,
          batchId: importBatch?.batchId,
        },
      });

      logger.info("Provenance record created", {
        provenanceId: provenanceRecord._id,
        promptId,
        sourceType,
      });

      return provenanceRecord;
    } catch (error) {
      logger.error("Failed to create provenance record", { error, params });
      throw error;
    }
  }

  /**
   * Add a transformation to an existing provenance record.
   */
  async addTransformation(params: UpdateTransformationParams): Promise<any> {
    try {
      const { provenanceId, transformation } = params;

      const provenanceRecord = await ProvenanceRecord.findById(provenanceId);
      if (!provenanceRecord) {
        throw new Error(`Provenance record not found: ${provenanceId}`);
      }

      // Add transformation
      provenanceRecord.transformations.push(transformation);
      await provenanceRecord.save();

      logger.info("Transformation added to provenance record", {
        provenanceId,
        transformType: transformation.transformType,
      });

      return provenanceRecord;
    } catch (error) {
      logger.error("Failed to add transformation", { error, params });
      throw error;
    }
  }

  /**
   * Get provenance record for a prompt.
   */
  async getProvenanceByPromptId(promptId: string): Promise<any | null> {
    try {
      return await ProvenanceRecord.findOne({
        promptId,
        isDeleted: false,
      }).sort({ createdAt: -1 });
    } catch (error) {
      logger.error("Failed to get provenance by prompt ID", { error, promptId });
      throw error;
    }
  }

  /**
   * Get full lineage for a prompt (all ancestor provenance records).
   */
  async getLineage(promptId: string): Promise<any[]> {
    try {
      const provenance = await this.getProvenanceByPromptId(promptId);
      if (!provenance) {
        return [];
      }

      const lineage = [provenance];
      let current = provenance;

      while (current.parentProvenanceId) {
        const parent = await ProvenanceRecord.findById(current.parentProvenanceId);
        if (!parent) break;
        lineage.unshift(parent);
        current = parent;
      }

      return lineage;
    } catch (error) {
      logger.error("Failed to get lineage", { error, promptId });
      throw error;
    }
  }

  /**
   * Get all derived prompts (descendants) from a prompt.
   */
  async getDerivatives(promptId: string): Promise<any[]> {
    try {
      const provenance = await this.getProvenanceByPromptId(promptId);
      if (!provenance) {
        return [];
      }

      return await provenance.getDescendants();
    } catch (error) {
      logger.error("Failed to get derivatives", { error, promptId });
      throw error;
    }
  }

  /**
   * Query provenance records with filters.
   */
  async queryProvenance(params: QueryProvenanceParams): Promise<any[]> {
    try {
      const {
        promptId,
        batchId,
        actorId,
        sourceType,
        startDate,
        endDate,
        limit = 100,
        includeDeleted = false,
      } = params;

      const query: any = {};

      if (promptId) query.promptId = promptId;
      if (batchId) query["importBatch.batchId"] = batchId;
      if (actorId) query["actor.actorId"] = actorId;
      if (sourceType) query.sourceType = sourceType;
      if (!includeDeleted) query.isDeleted = false;

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = startDate;
        if (endDate) query.createdAt.$lte = endDate;
      }

      return await ProvenanceRecord.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("promptId", "title onChainId owner")
        .populate("sourcePromptId", "title onChainId");
    } catch (error) {
      logger.error("Failed to query provenance", { error, params });
      throw error;
    }
  }

  /**
   * Get all prompts in an import batch.
   */
  async getBatchPrompts(batchId: string): Promise<any[]> {
    try {
      const provenanceRecords = await ProvenanceRecord.find({
        "importBatch.batchId": batchId,
        isDeleted: false,
      }).populate("promptId");

      return provenanceRecords.map((record) => record.promptId).filter(Boolean);
    } catch (error) {
      logger.error("Failed to get batch prompts", { error, batchId });
      throw error;
    }
  }

  /**
   * Verify provenance record integrity.
   */
  async verifyProvenance(provenanceId: string, verifiedBy: string, notes?: string): Promise<any> {
    try {
      const provenanceRecord = await ProvenanceRecord.findById(provenanceId);
      if (!provenanceRecord) {
        throw new Error(`Provenance record not found: ${provenanceId}`);
      }

      provenanceRecord.verificationStatus = "verified";
      provenanceRecord.verificationTimestamp = new Date();
      provenanceRecord.verificationNotes = notes || "";
      await provenanceRecord.save();

      await recordAuditEvent({
        action: "provenance_verified",
        result: "success",
        actor: verifiedBy,
        target: provenanceId,
        targetType: "provenance_record",
        metadata: { notes },
      });

      logger.info("Provenance verified", { provenanceId, verifiedBy });
      return provenanceRecord;
    } catch (error) {
      logger.error("Failed to verify provenance", { error, provenanceId });
      throw error;
    }
  }

  /**
   * Mark provenance as disputed.
   */
  async disputeProvenance(provenanceId: string, disputedBy: string, reason: string): Promise<any> {
    try {
      const provenanceRecord = await ProvenanceRecord.findById(provenanceId);
      if (!provenanceRecord) {
        throw new Error(`Provenance record not found: ${provenanceId}`);
      }

      provenanceRecord.verificationStatus = "disputed";
      provenanceRecord.verificationTimestamp = new Date();
      provenanceRecord.verificationNotes = reason;
      await provenanceRecord.save();

      await recordAuditEvent({
        action: "provenance_disputed",
        result: "success",
        actor: disputedBy,
        target: provenanceId,
        targetType: "provenance_record",
        metadata: { reason },
      });

      logger.warn("Provenance disputed", { provenanceId, disputedBy, reason });
      return provenanceRecord;
    } catch (error) {
      logger.error("Failed to dispute provenance", { error, provenanceId });
      throw error;
    }
  }

  /**
   * Soft delete a provenance record.
   */
  async deleteProvenance(provenanceId: string, deletedBy: string, reason: string): Promise<any> {
    try {
      const provenanceRecord = await ProvenanceRecord.findById(provenanceId);
      if (!provenanceRecord) {
        throw new Error(`Provenance record not found: ${provenanceId}`);
      }

      provenanceRecord.isDeleted = true;
      provenanceRecord.deletedAt = new Date();
      provenanceRecord.deletedBy = deletedBy;
      provenanceRecord.deletionReason = reason;
      await provenanceRecord.save();

      await recordAuditEvent({
        action: "provenance_deleted",
        result: "success",
        actor: deletedBy,
        target: provenanceId,
        targetType: "provenance_record",
        metadata: { reason },
      });

      logger.info("Provenance deleted", { provenanceId, deletedBy });
      return provenanceRecord;
    } catch (error) {
      logger.error("Failed to delete provenance", { error, provenanceId });
      throw error;
    }
  }

  /**
   * Export provenance data for a prompt or batch.
   */
  async exportProvenance(params: {
    promptId?: string;
    batchId?: string;
    format?: "json" | "csv";
  }): Promise<ProvenanceExport[]> {
    try {
      const { promptId, batchId } = params;

      const query: any = { isDeleted: false };
      if (promptId) query.promptId = promptId;
      if (batchId) query["importBatch.batchId"] = batchId;

      const records = await ProvenanceRecord.find(query)
        .populate("promptId", "title onChainId")
        .sort({ createdAt: 1 });

      const exports: ProvenanceExport[] = [];

      for (const record of records) {
        const lineage = await this.getLineage(record.promptId);
        
        exports.push({
          promptId: record.promptId,
          onChainId: record.onChainId,
          sourceType: record.sourceType,
          sourceSystem: record.sourceSystem,
          importBatch: record.importBatch,
          transformations: record.transformations,
          actor: record.actor,
          parentProvenanceId: record.parentProvenanceId?.toString(),
          lineageDepth: lineage.length,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
      }

      return exports;
    } catch (error) {
      logger.error("Failed to export provenance", { error, params });
      throw error;
    }
  }

  /**
   * Get import statistics.
   */
  async getImportStatistics(params: {
    startDate?: Date;
    endDate?: Date;
    sourceType?: ImportSourceType;
    actorId?: string;
  }): Promise<any> {
    try {
      return await ProvenanceRecord.getImportStats(params);
    } catch (error) {
      logger.error("Failed to get import statistics", { error, params });
      throw error;
    }
  }

  /**
   * Handle deleted source prompts - mark provenance as invalid.
   */
  async handleDeletedSource(sourcePromptId: string): Promise<void> {
    try {
      const affectedRecords = await ProvenanceRecord.find({
        sourcePromptId,
        isDeleted: false,
      });

      for (const record of affectedRecords) {
        record.verificationStatus = "invalid";
        record.verificationTimestamp = new Date();
        record.verificationNotes = "Source prompt was deleted";
        await record.save();
      }

      logger.info("Updated provenance for deleted source", {
        sourcePromptId,
        affectedCount: affectedRecords.length,
      });
    } catch (error) {
      logger.error("Failed to handle deleted source", { error, sourcePromptId });
      throw error;
    }
  }
}

export const provenanceService = new ProvenanceService();


/**
 * Create provenance record for a derived prompt (fork, remix, parent, source).
 * Integrates with the existing PromptRelation system from issue #753.
 */
export async function trackDerivedPrompt(params: {
  promptId: string;
  onChainId?: string;
  parentPromptId: string;
  parentOnChainId?: string;
  relationKind: "fork" | "remix" | "parent" | "source";
  actor: IActorMetadata;
  transformationType?: TransformType;
  transformDetails?: string;
}): Promise<{ provenanceRecord: any; promptRelation: any }> {
  const {
    promptId,
    onChainId,
    parentPromptId,
    parentOnChainId,
    relationKind,
    actor,
    transformationType,
    transformDetails,
  } = params;

  try {
    // 1. Get parent provenance record if it exists
    const parentProvenance = await ProvenanceRecord.findOne({
      $or: [{ promptId: parentPromptId }, { onChainId: parentOnChainId }],
    });

    // 2. Determine transform type based on relation kind
    let transformType: TransformType;
    switch (relationKind) {
      case "fork":
        transformType = transformationType || "FORK";
        break;
      case "remix":
        transformType = transformationType || "REMIX";
        break;
      case "parent":
        transformType = "VERSION_UPDATE";
        break;
      case "source":
        transformType = "CONTENT_ENHANCEMENT";
        break;
    }

    // 3. Create provenance record for the derived prompt
    const transformations: Partial<ITransformMetadata>[] = [
      {
        transformType,
        timestamp: new Date(),
        actor,
        details: transformDetails || `Derived from prompt ${parentOnChainId || parentPromptId} via ${relationKind}`,
      },
    ];

    // If parent has provenance, inherit some metadata
    const sourceSystem: ISourceSystem = parentProvenance
      ? {
          name: parentProvenance.sourceSystem.name,
          version: parentProvenance.sourceSystem.version,
          identifier: `derived_from_${parentOnChainId || parentPromptId}`,
        }
      : {
          name: "PromptHash Platform",
          version: "1.0",
          identifier: `derived_from_${parentOnChainId || parentPromptId}`,
        };

    const provenanceRecord = await createProvenanceRecord({
      promptId,
      onChainId,
      sourceType: "BLOCKCHAIN", // Derived prompts typically come from on-chain parents
      sourceSystem,
      transformations,
      actor,
      parentRecordId: parentProvenance ? String(parentProvenance._id) : undefined,
    });

    // 4. Update the prompt with provenance reference
    await Prompt.findByIdAndUpdate(promptId, {
      $set: {
        provenanceRecordId: provenanceRecord._id,
        provenanceSource: "BLOCKCHAIN",
        provenanceActorId: actor.userId || actor.walletAddress,
        hasProvenance: true,
      },
    });

    // 5. Create PromptRelation record if it doesn't exist (to maintain compatibility with #753)
    const promptRelation = await PromptRelation.findOneAndUpdate(
      {
        promptId: onChainId || promptId,
        relatedPromptId: parentOnChainId || parentPromptId,
      },
      {
        $set: {
          kind: relationKind,
          origin: "creator",
          declaredBy: actor.walletAddress?.toLowerCase(),
        },
      },
      { upsert: true, new: true },
    );

    // 6. Record audit event
    await recordAuditEvent({
      actor: actor.walletAddress || actor.userId || "system",
      action: "prompt.derived",
      resource: `prompt:${promptId}`,
      metadata: {
        parentPromptId,
        relationKind,
        transformType,
        provenanceRecordId: String(provenanceRecord._id),
      },
    });

    logger.info("Tracked derived prompt", {
      action: "trackDerivedPrompt",
      promptId,
      parentPromptId,
      relationKind,
      transformType,
    });

    return { provenanceRecord, promptRelation };
  } catch (error: any) {
    logger.error("Failed to track derived prompt", {
      action: "trackDerivedPrompt",
      error: error.message,
      promptId,
      parentPromptId,
    });
    throw error;
  }
}

/**
 * Batch track multiple derived prompts (useful for bulk fork/remix operations).
 */
export async function trackDerivedPrompts(
  derivations: Array<{
    promptId: string;
    onChainId?: string;
    parentPromptId: string;
    parentOnChainId?: string;
    relationKind: "fork" | "remix" | "parent" | "source";
    actor: IActorMetadata;
    transformationType?: TransformType;
    transformDetails?: string;
  }>,
): Promise<{ successes: number; failures: number; results: any[] }> {
  const results = [];
  let successes = 0;
  let failures = 0;

  for (const derivation of derivations) {
    try {
      const result = await trackDerivedPrompt(derivation);
      results.push({ success: true, ...result });
      successes++;
    } catch (error: any) {
      results.push({
        success: false,
        promptId: derivation.promptId,
        error: error.message,
      });
      failures++;
    }
  }

  logger.info("Batch tracked derived prompts", {
    action: "trackDerivedPrompts",
    total: derivations.length,
    successes,
    failures,
  });

  return { successes, failures, results };
}

/**
 * Get all forks and remixes of a prompt (combines ProvenanceRecord and PromptRelation data).
 */
export async function getDerivativesWithProvenance(promptId: string): Promise<any[]> {
  const [provenanceDerivatives, relationDerivatives] = await Promise.all([
    ProvenanceRecord.find({ parentRecordId: promptId }).lean(),
    PromptRelation.find({
      relatedPromptId: promptId,
      kind: { $in: ["fork", "remix", "parent"] },
    }).lean(),
  ]);

  // Combine both sources and deduplicate
  const derivativeMap = new Map();

  for (const prov of provenanceDerivatives) {
    derivativeMap.set(prov.promptId, {
      promptId: prov.promptId,
      onChainId: prov.onChainId,
      source: "provenance",
      transformations: prov.transformations,
      actor: prov.actor,
      createdAt: prov.createdAt,
    });
  }

  for (const rel of relationDerivatives) {
    const existing = derivativeMap.get(rel.promptId);
    if (existing) {
      existing.relationKind = rel.kind;
      existing.relationOrigin = rel.origin;
    } else {
      derivativeMap.set(rel.promptId, {
        promptId: rel.promptId,
        source: "relation",
        relationKind: rel.kind,
        relationOrigin: rel.origin,
        declaredBy: rel.declaredBy,
        createdAt: rel.createdAt,
      });
    }
  }

  return Array.from(derivativeMap.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}


/**
 * Track a prompt update and preserve provenance history.
 * Adds a new transformation to the existing provenance record.
 */
export async function trackPromptUpdate(params: {
  promptId: string;
  onChainId?: string;
  updateType: TransformType;
  updateDetails: string;
  actor: IActorMetadata;
  changedFields?: string[];
  previousVersion?: any;
}): Promise<any> {
  const { promptId, onChainId, updateType, updateDetails, actor, changedFields, previousVersion } = params;

  try {
    // 1. Find existing provenance record
    let provenance = await ProvenanceRecord.findOne({
      $or: [{ promptId }, { onChainId }],
    });

    if (!provenance) {
      // If no provenance exists, create a minimal one for the update
      logger.warn("No existing provenance found for update, creating new record", {
        action: "trackPromptUpdate",
        promptId,
      });

      provenance = await createProvenanceRecord({
        promptId,
        onChainId,
        sourceType: "MANUAL_ENTRY",
        sourceSystem: {
          name: "PromptHash Platform",
          version: "1.0",
          identifier: `prompt_${onChainId || promptId}`,
        },
        actor,
      });
    }

    // 2. Add transformation to the provenance record
    const transformation: Partial<ITransformMetadata> = {
      transformType: updateType,
      timestamp: new Date(),
      actor,
      details: updateDetails,
      metadata: {
        changedFields: changedFields || [],
        previousVersion: previousVersion ? JSON.stringify(previousVersion) : undefined,
      },
    };

    provenance.transformations.push(transformation as any);
    await provenance.save();

    // 3. Update the prompt's updatedAt timestamp (handled by Mongoose)
    await Prompt.findByIdAndUpdate(promptId, {
      $set: { provenanceRecordId: provenance._id },
    });

    // 4. Record audit event
    await recordAuditEvent({
      actor: actor.walletAddress || actor.userId || "system",
      action: "prompt.updated",
      resource: `prompt:${promptId}`,
      metadata: {
        updateType,
        changedFields,
        provenanceRecordId: String(provenance._id),
      },
    });

    logger.info("Tracked prompt update in provenance", {
      action: "trackPromptUpdate",
      promptId,
      updateType,
      transformationCount: provenance.transformations.length,
    });

    return {
      provenanceRecord: provenance,
      transformation,
    };
  } catch (error: any) {
    logger.error("Failed to track prompt update", {
      action: "trackPromptUpdate",
      error: error.message,
      promptId,
    });
    throw error;
  }
}

/**
 * Preserve provenance when a prompt is deleted (soft delete).
 * Marks the provenance record as archived but preserves all history.
 */
export async function archiveProvenance(params: {
  promptId: string;
  onChainId?: string;
  actor: IActorMetadata;
  reason?: string;
}): Promise<void> {
  const { promptId, onChainId, actor, reason } = params;

  try {
    const provenance = await ProvenanceRecord.findOne({
      $or: [{ promptId }, { onChainId }],
    });

    if (!provenance) {
      logger.warn("No provenance record found to archive", {
        action: "archiveProvenance",
        promptId,
      });
      return;
    }

    // Add archival transformation
    provenance.transformations.push({
      transformType: "VALIDATION", // Using VALIDATION to represent archival
      timestamp: new Date(),
      actor,
      details: `Prompt archived: ${reason || "No reason provided"}`,
      metadata: {
        archived: true,
        archivedAt: new Date().toISOString(),
      },
    } as any);

    await provenance.save();

    await recordAuditEvent({
      actor: actor.walletAddress || actor.userId || "system",
      action: "prompt.archived",
      resource: `prompt:${promptId}`,
      metadata: {
        reason,
        provenanceRecordId: String(provenance._id),
      },
    });

    logger.info("Archived provenance record", {
      action: "archiveProvenance",
      promptId,
    });
  } catch (error: any) {
    logger.error("Failed to archive provenance", {
      action: "archiveProvenance",
      error: error.message,
      promptId,
    });
    throw error;
  }
}

/**
 * Restore archived provenance when a prompt is undeleted.
 */
export async function restoreProvenance(params: {
  promptId: string;
  onChainId?: string;
  actor: IActorMetadata;
}): Promise<void> {
  const { promptId, onChainId, actor } = params;

  try {
    const provenance = await ProvenanceRecord.findOne({
      $or: [{ promptId }, { onChainId }],
    });

    if (!provenance) {
      logger.warn("No provenance record found to restore", {
        action: "restoreProvenance",
        promptId,
      });
      return;
    }

    // Add restoration transformation
    provenance.transformations.push({
      transformType: "VALIDATION",
      timestamp: new Date(),
      actor,
      details: "Prompt restored from archive",
      metadata: {
        restored: true,
        restoredAt: new Date().toISOString(),
      },
    } as any);

    await provenance.save();

    await recordAuditEvent({
      actor: actor.walletAddress || actor.userId || "system",
      action: "prompt.restored",
      resource: `prompt:${promptId}`,
      metadata: {
        provenanceRecordId: String(provenance._id),
      },
    });

    logger.info("Restored provenance record", {
      action: "restoreProvenance",
      promptId,
    });
  } catch (error: any) {
    logger.error("Failed to restore provenance", {
      action: "restoreProvenance",
      error: error.message,
      promptId,
    });
    throw error;
  }
}

/**
 * Get the complete update history for a prompt from its provenance.
 */
export async function getUpdateHistory(promptId: string): Promise<{
  promptId: string;
  totalUpdates: number;
  updates: Array<{
    transformType: string;
    timestamp: Date;
    actor: any;
    details: string;
    metadata?: any;
  }>;
}> {
  const provenance = await ProvenanceRecord.findOne({
    $or: [{ promptId }, { onChainId: promptId }],
  });

  if (!provenance) {
    return {
      promptId,
      totalUpdates: 0,
      updates: [],
    };
  }

  // Filter for update-related transformations
  const updateTransforms = [
    "VERSION_UPDATE",
    "CONTENT_ENHANCEMENT",
    "NORMALIZATION",
    "ENRICHMENT",
    "VALIDATION",
  ];

  const updates = provenance.transformations
    .filter((t) => updateTransforms.includes(t.transformType))
    .map((t) => ({
      transformType: t.transformType,
      timestamp: t.timestamp,
      actor: t.actor,
      details: t.details,
      metadata: t.metadata,
    }));

  return {
    promptId,
    totalUpdates: updates.length,
    updates: updates.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
  };
}

/**
 * Compare two versions of a prompt and generate a diff summary.
 */
export function generateUpdateDiff(
  previous: any,
  current: any,
): {
  changedFields: string[];
  additions: Record<string, any>;
  deletions: Record<string, any>;
  modifications: Record<string, { old: any; new: any }>;
} {
  const changedFields: string[] = [];
  const additions: Record<string, any> = {};
  const deletions: Record<string, any> = {};
  const modifications: Record<string, { old: any; new: any }> = {};

  const allKeys = new Set([...Object.keys(previous || {}), ...Object.keys(current || {})]);

  for (const key of allKeys) {
    // Skip internal fields
    if (key.startsWith("_") || key === "__v" || key === "updatedAt") {
      continue;
    }

    const prevValue = previous?.[key];
    const currValue = current?.[key];

    if (prevValue === undefined && currValue !== undefined) {
      additions[key] = currValue;
      changedFields.push(key);
    } else if (prevValue !== undefined && currValue === undefined) {
      deletions[key] = prevValue;
      changedFields.push(key);
    } else if (JSON.stringify(prevValue) !== JSON.stringify(currValue)) {
      modifications[key] = { old: prevValue, new: currValue };
      changedFields.push(key);
    }
  }

  return {
    changedFields,
    additions,
    deletions,
    modifications,
  };
}
