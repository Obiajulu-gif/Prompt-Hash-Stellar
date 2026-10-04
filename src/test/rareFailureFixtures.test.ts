import { describe, it, expect } from "vitest";
import {
  RARE_FAILURE_FIXTURES,
  validateFixtureSchema,
  executeRepairPath,
} from "./fixtures/rareFailureFixtures";

describe("Rare Failure Modes Fixtures and Manual Repair Paths (#922)", () => {
  it("loads all deterministic rare failure fixtures reliably in local environment", () => {
    expect(RARE_FAILURE_FIXTURES).toBeDefined();
    expect(RARE_FAILURE_FIXTURES.length).toBeGreaterThanOrEqual(3);
  });

  it("validates that all fixtures match current schema rules", () => {
    for (const fixture of RARE_FAILURE_FIXTURES) {
      expect(validateFixtureSchema(fixture)).toBe(true);
      expect(fixture.expectedRepairPath).toBeTruthy();
      expect(fixture.expectedRepairPath.length).toBeGreaterThan(10);
    }
  });

  it("confirms repair flow execution for ORPHANED_ONCHAIN_PURCHASE fixture", async () => {
    const fixture = RARE_FAILURE_FIXTURES.find(
      (f) => f.failureMode === "ORPHANED_ONCHAIN_PURCHASE"
    )!;
    expect(fixture).toBeDefined();

    const repairResult = await executeRepairPath(fixture);
    expect(repairResult.success).toBe(true);
    expect(repairResult.message).toContain("Successfully verified Stellar tx");
    expect(repairResult.repairedPayload.status).toBe("CLAIMED_CONFIRMED");
  });

  it("confirms repair flow execution for DESYNCED_PROMPT_CONTENT_HASH fixture", async () => {
    const fixture = RARE_FAILURE_FIXTURES.find(
      (f) => f.failureMode === "DESYNCED_PROMPT_CONTENT_HASH"
    )!;
    expect(fixture).toBeDefined();

    const repairResult = await executeRepairPath(fixture);
    expect(repairResult.success).toBe(true);
    expect(repairResult.repairedPayload.status).toBe("SYNCHRONIZED");
    expect(repairResult.repairedPayload.actualHash).toBe(fixture.payload.expectedHash);
  });

  it("confirms repair flow execution for STALE_PAYOUT_LEDGER_GAP fixture", async () => {
    const fixture = RARE_FAILURE_FIXTURES.find(
      (f) => f.failureMode === "STALE_PAYOUT_LEDGER_GAP"
    )!;
    expect(fixture).toBeDefined();

    const repairResult = await executeRepairPath(fixture);
    expect(repairResult.success).toBe(true);
    expect(repairResult.repairedPayload.status).toBe("RECONCILED");
  });
});
