import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { incidentDrillRunner } from "../services/incidentDrillService.js";

const runbook = readFileSync(
  new URL("../../../docs/incident-drill-runbook.md", import.meta.url),
  "utf8",
);

describe("issue #1155 executable incident runbook", () => {
  it("documents every executable drill step exposed by the runner", () => {
    const steps = incidentDrillRunner.listSteps();
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(runbook).toContain(`\`${step.id}\``);
      expect(step.description.length).toBeGreaterThan(0);
    }
  });

  it("documents the recovery command and rollback section", () => {
    expect(runbook).toContain("yarn test --run src/tests/incidentDrill.test.ts");
    expect(runbook).toContain("## Rollback Steps");
    expect(runbook).toContain("## Operational Edge Cases");
  });

  it("keeps the drill outcome machine-checkable for failed recovery checks", async () => {
    const result = await incidentDrillRunner.runStep("D1_sanitize_sensitive_data_function");
    expect(result).toMatchObject({
      id: "D1_sanitize_sensitive_data_function",
      status: expect.any(String),
      evidence: expect.any(String),
    });
  });
});
