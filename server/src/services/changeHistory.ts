import { createHash } from "crypto";
import {
  ChangeHistoryEntry,
  CriticalRecordType,
  ChangeOperation,
  CRITICAL_RECORD_TYPES,
  CHANGE_OPERATIONS,
  IChangeHistoryEntry,
} from "../models/ChangeHistoryEntry";
import { canonicalJson } from "./auditTrail";
import { logger } from "./structuredLogger";

export const GENESIS_HASH = "0".repeat(64);

export interface HistoryHashInput {
  recordType: CriticalRecordType;
  recordId: string;
  sequence: number;
  operation: ChangeOperation;
  actor: string;
  reason: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown>;
  previousHash: string;
  createdAt: Date;
}

/**
 * Deterministically computes the SHA-256 hash of a change history entry.
 */
export function computeChangeHistoryHash(input: HistoryHashInput): string {
  const payload = canonicalJson({
    recordType: input.recordType,
    recordId: input.recordId,
    sequence: input.sequence,
    operation: input.operation,
    actor: input.actor.trim(),
    reason: input.reason.trim(),
    beforeState: input.beforeState ?? null,
    afterState: input.afterState,
    previousHash: input.previousHash,
    createdAt: input.createdAt.toISOString(),
  });

  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Computes which fields changed between beforeState and afterState.
 */
export function computeChangedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  const changed = new Set<string>();
  const beforeKeys = before ? Object.keys(before) : [];
  const afterKeys = Object.keys(after);

  for (const key of afterKeys) {
    if (!before || JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.add(key);
    }
  }

  for (const key of beforeKeys) {
    if (!(key in after)) {
      changed.add(key);
    }
  }

  return Array.from(changed).sort();
}

export interface RecordMutationParams {
  recordType: CriticalRecordType;
  recordId: string;
  operation: ChangeOperation;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown>;
  actor: string;
  reason: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

export interface VerificationResult {
  valid: boolean;
  totalEntries: number;
  errors: string[];
}

/**
 * Service managing tamper-evident history for critical domain records.
 */
export class ChangeHistoryService {
  /**
   * Persists a tamper-evident change record for a critical mutation.
   */
  static async recordMutation(
    params: RecordMutationParams,
  ): Promise<IChangeHistoryEntry> {
    if (!CRITICAL_RECORD_TYPES.includes(params.recordType)) {
      throw new Error(`Invalid record type: ${params.recordType}`);
    }
    if (!CHANGE_OPERATIONS.includes(params.operation)) {
      throw new Error(`Invalid operation: ${params.operation}`);
    }
    if (!params.actor || params.actor.trim() === "") {
      throw new Error("Mutation rejected: actor is required for critical record audit");
    }
    if (!params.reason || params.reason.trim() === "") {
      throw new Error("Mutation rejected: reason is required for critical record audit");
    }
    if (!params.afterState || typeof params.afterState !== "object") {
      throw new Error("Mutation rejected: afterState is required");
    }

    // Find the latest history entry for this entity to chain hashes
    const lastEntry = await ChangeHistoryEntry.findOne({
      recordType: params.recordType,
      recordId: params.recordId,
    })
      .sort({ sequence: -1 })
      .lean();

    const sequence = lastEntry ? lastEntry.sequence + 1 : 1;
    const previousHash = lastEntry ? lastEntry.recordHash : GENESIS_HASH;
    const now = params.timestamp || new Date();

    const changedFields = computeChangedFields(
      params.beforeState,
      params.afterState,
    );

    const recordHash = computeChangeHistoryHash({
      recordType: params.recordType,
      recordId: params.recordId,
      sequence,
      operation: params.operation,
      actor: params.actor,
      reason: params.reason,
      beforeState: params.beforeState,
      afterState: params.afterState,
      previousHash,
      createdAt: now,
    });

    const entry = await ChangeHistoryEntry.create({
      recordType: params.recordType,
      recordId: params.recordId,
      sequence,
      operation: params.operation,
      beforeState: params.beforeState,
      afterState: params.afterState,
      changedFields,
      actor: params.actor.trim(),
      reason: params.reason.trim(),
      metadata: params.metadata || {},
      previousHash,
      recordHash,
      createdAt: now,
    });

    logger.info("change_history: recorded mutation", {
      recordType: params.recordType,
      recordId: params.recordId,
      sequence,
      operation: params.operation,
      actor: params.actor,
      recordHash,
    });

    return entry;
  }

  /**
   * Verifies the cryptographic chain and state continuity of an ordered sequence of entries.
   */
  static verifyChain(
    entries: Array<{
      sequence: number;
      recordType: CriticalRecordType;
      recordId: string;
      operation: ChangeOperation;
      actor: string;
      reason: string;
      beforeState: Record<string, unknown> | null;
      afterState: Record<string, unknown>;
      previousHash: string;
      recordHash: string;
      createdAt: Date | string;
    }>,
  ): VerificationResult {
    const errors: string[] = [];
    if (entries.length === 0) {
      return { valid: true, totalEntries: 0, errors: [] };
    }

    let expectedPrevHash = GENESIS_HASH;
    let expectedSequence = 1;
    let previousTimestamp: number | null = null;
    let previousAfterState: Record<string, unknown> | null = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const entryTime = new Date(entry.createdAt).getTime();

      // 1. Verify sequence progression (detects missing records)
      if (entry.sequence !== expectedSequence) {
        errors.push(
          `Sequence mismatch at index ${i}: expected ${expectedSequence} but got ${entry.sequence} (missing or duplicate record)`,
        );
      }

      // 2. Verify timestamp monotonicity (detects reordered records)
      if (previousTimestamp !== null && entryTime < previousTimestamp) {
        errors.push(
          `Timestamp regression at sequence ${entry.sequence}: entry timestamp ${new Date(entryTime).toISOString()} is earlier than previous entry ${new Date(previousTimestamp).toISOString()}`,
        );
      }

      // 3. Verify previous hash chaining
      if (entry.previousHash !== expectedPrevHash) {
        errors.push(
          `Hash chain break at sequence ${entry.sequence}: previousHash ${entry.previousHash} does not match expected ${expectedPrevHash}`,
        );
      }

      // 4. Verify state continuity (beforeState matches previous afterState)
      if (i > 0 && previousAfterState !== null) {
        const canonicalPrevAfter = canonicalJson(previousAfterState);
        const canonicalCurBefore = canonicalJson(entry.beforeState);
        if (canonicalCurBefore !== canonicalPrevAfter) {
          errors.push(
            `State continuity violation at sequence ${entry.sequence}: beforeState does not match previous afterState`,
          );
        }
      }

      // 5. Recompute and verify cryptographic recordHash (detects altered payload)
      const expectedRecordHash = computeChangeHistoryHash({
        recordType: entry.recordType,
        recordId: entry.recordId,
        sequence: entry.sequence,
        operation: entry.operation,
        actor: entry.actor,
        reason: entry.reason,
        beforeState: entry.beforeState,
        afterState: entry.afterState,
        previousHash: entry.previousHash,
        createdAt: new Date(entry.createdAt),
      });

      if (entry.recordHash !== expectedRecordHash) {
        errors.push(
          `Tampered record at sequence ${entry.sequence}: stored hash ${entry.recordHash} does not match computed hash ${expectedRecordHash}`,
        );
      }

      expectedPrevHash = entry.recordHash;
      expectedSequence = entry.sequence + 1;
      previousTimestamp = entryTime;
      previousAfterState = entry.afterState;
    }

    return {
      valid: errors.length === 0,
      totalEntries: entries.length,
      errors,
    };
  }

  /**
   * Verifies the complete history chain for a specific domain record.
   */
  static async verifyRecordHistory(
    recordType: CriticalRecordType,
    recordId: string,
  ): Promise<VerificationResult> {
    const entries = await ChangeHistoryEntry.find({
      recordType,
      recordId,
    })
      .sort({ sequence: 1, createdAt: 1 })
      .lean();

    return this.verifyChain(entries as any);
  }

  /**
   * Retrieves the change history entries for a specific record.
   */
  static async getRecordHistory(
    recordType: CriticalRecordType,
    recordId: string,
  ): Promise<IChangeHistoryEntry[]> {
    return ChangeHistoryEntry.find({ recordType, recordId })
      .sort({ sequence: 1 })
      .lean();
  }

  /**
   * Verifies all change history across records, optionally filtered by record type.
   */
  static async verifyAllHistory(filter?: {
    recordType?: CriticalRecordType;
  }): Promise<VerificationResult> {
    const query: Record<string, unknown> = {};
    if (filter?.recordType) {
      query.recordType = filter.recordType;
    }

    const allEntries = await ChangeHistoryEntry.find(query)
      .sort({ recordType: 1, recordId: 1, sequence: 1 })
      .lean();

    // Group by recordType + recordId
    const groups = new Map<string, typeof allEntries>();
    for (const entry of allEntries) {
      const key = `${entry.recordType}:${entry.recordId}`;
      const group = groups.get(key) || [];
      group.push(entry);
      groups.set(key, group);
    }

    const allErrors: string[] = [];
    let totalEntries = 0;

    for (const [key, chain] of groups.entries()) {
      totalEntries += chain.length;
      const res = this.verifyChain(chain as any);
      if (!res.valid) {
        allErrors.push(
          ...res.errors.map((err) => `[${key}] ${err}`),
        );
      }
    }

    return {
      valid: allErrors.length === 0,
      totalEntries,
      errors: allErrors,
    };
  }
}
