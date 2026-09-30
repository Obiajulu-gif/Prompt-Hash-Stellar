import { describe, it, expect } from "vitest";
import {
  MigrationSafetyFramework,
  MigrationStep,
} from "../services/migrationSafetyFramework";

interface TestPromptRecord extends Record<string, unknown> {
  _id: string;
  title: string;
  price: number;
  basisPoints?: number;
}

describe("MigrationSafetyFramework (Issue #833)", () => {
  const sampleMigration: MigrationStep<TestPromptRecord> = {
    id: "mig_2026_payout_basis_points",
    name: "Migrate flat royalties to basis points",
    description: "Converts percentage royalty numbers to 10000-based basis points",
    targetCollection: "prompts",
    query: { basisPoints: { $exists: false } },
    transform: (record) => ({
      basisPoints: (record.price > 0 ? 1000 : 0),
    }),
    postValidation: (record) => typeof record.basisPoints === "number" && record.basisPoints >= 0,
    rollbackQuery: { basisPoints: { $exists: true } },
    rollbackTransform: () => ({ $unset: { basisPoints: "" } }),
  };

  it("performs dry-run preview without mutating database records", async () => {
    const mockRecords: TestPromptRecord[] = [
      { _id: "p1", title: "Cyberpunk Prompt", price: 50 },
      { _id: "p2", title: "Fantasy Architecture", price: 100 },
    ];

    const report = await MigrationSafetyFramework.dryRun(sampleMigration, mockRecords);

    expect(report.migrationId).toBe("mig_2026_payout_basis_points");
    expect(report.totalMatched).toBe(2);
    expect(report.safeToApply).toBe(true);
    expect(report.sampleTransforms).toHaveLength(2);
    expect(report.sampleTransforms[0].after.basisPoints).toBe(1000);
    // Original record untouched in dry-run
    expect(mockRecords[0].basisPoints).toBeUndefined();
  });

  it("executes migration with post-validation assertions", async () => {
    const mockRecords: TestPromptRecord[] = [
      { _id: "p1", title: "Cyberpunk Prompt", price: 50 },
    ];

    const persistedUpdates: Record<string, unknown>[] = [];
    const persistFn = async (_id: string, updates: Record<string, unknown>) => {
      persistedUpdates.push(updates);
    };

    const result = await MigrationSafetyFramework.execute(
      sampleMigration,
      mockRecords,
      persistFn
    );

    expect(result.appliedCount).toBe(1);
    expect(result.postValidationPassed).toBe(true);
    expect(result.validationErrors).toHaveLength(0);
    expect(persistedUpdates[0].basisPoints).toBe(1000);
  });

  it("generates documented rollback and forward-fix runbook", () => {
    const plan = MigrationSafetyFramework.generateRollbackPlan(sampleMigration);
    expect(plan.migrationId).toBe("mig_2026_payout_basis_points");
    expect(plan.instructions.length).toBeGreaterThanOrEqual(3);
    expect(plan.rollbackQuery).toBeDefined();
  });
});
