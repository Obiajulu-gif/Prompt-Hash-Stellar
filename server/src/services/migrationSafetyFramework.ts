export interface MigrationStep<T = unknown> {
  id: string;
  name: string;
  description: string;
  targetCollection: string;
  query: Record<string, unknown>;
  transform: (record: T) => Record<string, unknown> | null;
  postValidation: (record: T) => boolean;
  rollbackQuery?: Record<string, unknown>;
  rollbackTransform?: (record: T) => Record<string, unknown> | null;
}

export interface DryRunReport {
  migrationId: string;
  totalMatched: number;
  sampleTransforms: Array<{
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }>;
  estimatedDurationMs: number;
  warnings: string[];
  safeToApply: boolean;
}

export interface MigrationExecutionResult {
  migrationId: string;
  appliedCount: number;
  skippedCount: number;
  errorCount: number;
  postValidationPassed: boolean;
  validationErrors: string[];
  durationMs: number;
  rollbackReady: boolean;
}

export class MigrationSafetyFramework {
  /**
   * Dry-run preview: simulates the migration over matched records without persisting changes.
   */
  static async dryRun<T extends Record<string, unknown>>(
    migration: MigrationStep<T>,
    records: T[]
  ): Promise<DryRunReport> {
    const startTime = Date.now();
    const sampleTransforms: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }> = [];
    const warnings: string[] = [];
    let validTransformCount = 0;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      try {
        const transformed = migration.transform(record);
        if (transformed) {
          validTransformCount++;
          if (sampleTransforms.length < 5) {
            sampleTransforms.push({
              before: { ...record },
              after: { ...record, ...transformed },
            });
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Record index ${i} failed transform simulation: ${message}`);
      }
    }

    const duration = Date.now() - startTime;
    return {
      migrationId: migration.id,
      totalMatched: records.length,
      sampleTransforms,
      estimatedDurationMs: Math.max(1, duration * (records.length > 0 ? records.length / Math.min(records.length, 100) : 1)),
      warnings,
      safeToApply: warnings.length === 0 && validTransformCount > 0,
    };
  }

  /**
   * Executes migration with pre-checks and post-checks.
   */
  static async execute<T extends Record<string, unknown>>(
    migration: MigrationStep<T>,
    records: T[],
    persistFn: (id: string, updates: Record<string, unknown>) => Promise<void>
  ): Promise<MigrationExecutionResult> {
    const startTime = Date.now();
    let appliedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const validationErrors: string[] = [];

    for (const record of records) {
      try {
        const updates = migration.transform(record);
        if (!updates) {
          skippedCount++;
          continue;
        }

        const id = String(record._id || record.id || "");
        if (id) {
          await persistFn(id, updates);
          appliedCount++;

          const merged = { ...record, ...updates } as T;
          if (!migration.postValidation(merged)) {
            validationErrors.push(`Post-validation failed on record ${id}`);
          }
        } else {
          errorCount++;
          validationErrors.push("Record missing valid ID identifier for update");
        }
      } catch (err: unknown) {
        errorCount++;
        const message = err instanceof Error ? err.message : String(err);
        validationErrors.push(`Update failed on record: ${message}`);
      }
    }

    return {
      migrationId: migration.id,
      appliedCount,
      skippedCount,
      errorCount,
      postValidationPassed: validationErrors.length === 0 && errorCount === 0,
      validationErrors,
      durationMs: Date.now() - startTime,
      rollbackReady: typeof migration.rollbackTransform === "function",
    };
  }

  /**
   * Generates a documented rollback plan with verification steps.
   */
  static generateRollbackPlan<T>(migration: MigrationStep<T>): {
    migrationId: string;
    rollbackQuery: Record<string, unknown>;
    forwardFixStrategy: string;
    instructions: string[];
  } {
    return {
      migrationId: migration.id,
      rollbackQuery: migration.rollbackQuery || migration.query,
      forwardFixStrategy: "Re-run migration with corrected transform mapping after fixing failed assertions",
      instructions: [
        `1. Pause active background workers targeting collection '${migration.targetCollection}'.`,
        `2. Execute rollback query against records modified by '${migration.id}'.`,
        `3. Validate collection invariants using DomainInvariantsService.`,
        `4. Resume worker queues and verify service metrics.`,
      ],
    };
  }
}
