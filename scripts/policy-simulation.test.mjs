/**
 * Automated Test Suite for Policy Simulation (#1182).
 *
 * Verifies all acceptance criteria:
 *   1. Normal path: fee adjustment, price limit, creator suspension, bulk refund, custom rules.
 *   2. Failure path: invalid policy definitions, negative prices/fees, exceeding selection limits.
 *   3. Retry & Drift path: HMAC confirmation tokens, idempotent runs, drift rejection on version change.
 *   4. Authorization path: actor privilege enforcement (admin / policy:evaluate).
 *   5. Rollback & Irreversibility path: flags irreversible actions and specifies rollback procedures.
 *   6. CLI runner path: argument parsing, summary/json formatting, and exit codes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/policy-simulation.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  simulatePolicyChange,
  simulateFeeAdjustment,
  simulatePriceLimit,
  simulateCreatorSuspension,
  simulateBulkRefund,
  simulateCustomRule,
  verifySimulationConfirmationToken,
  PolicyEvaluationError,
  MAX_EVALUATION_RECORDS,
  MAX_PREVIEW_RECORDS,
} from "../server/src/services/policySimulation.ts";
import {
  parseCliArgs,
  runPolicySimulationCli,
} from "./policy-simulation.mjs";

const TEST_SECRET = "test-policy-simulation-secret-key-123456";

const ADMIN_ACTOR = {
  id: "ops-alice",
  role: "admin",
  permissions: new Set(["admin"]),
};

const POLICY_ACTOR = {
  id: "policy-officer-bob",
  role: "operator",
  permissions: new Set(["policy:evaluate"]),
};

const UNAUTHORIZED_ACTOR = {
  id: "viewer-carol",
  role: "viewer",
  permissions: new Set(["prompts:read"]),
};

const SAMPLE_PROMPTS = [
  { id: "p1", version: 1, status: "active", priceXlm: 150, creatorAddress: "G_ALICE", tags: ["gpt4", "crypto"] },
  { id: "p2", version: 2, status: "active", priceXlm: 45, creatorAddress: "G_BOB", tags: ["claude", "nlp"] },
  { id: "p3", version: 1, status: "paused", priceXlm: 200, creatorAddress: "G_ALICE", tags: ["gpt4", "code"] },
  { id: "p4", version: 3, status: "active", priceXlm: 80, creatorAddress: "G_CAROL", tags: ["vision", "art"] },
];

describe("Policy Simulation Service (#1182)", () => {
  // 1. NORMAL PATHS
  describe("Normal Simulation Pathways", () => {
    it("simulates fee adjustment with volume impact and reversible rollback procedure", async () => {
      const result = await simulateFeeAdjustment(
        { newFeePercentage: 0.08 },
        "Protocol treasury fee increase",
        ADMIN_ACTOR.id,
        { actor: ADMIN_ACTOR, candidateRecords: SAMPLE_PROMPTS, secret: TEST_SECRET },
      );

      assert.equal(result.policyChange.type, "fee_adjustment");
      assert.equal(result.scannedCount, 4);
      assert.equal(result.affectedCount, 4);
      assert.equal(result.isIrreversible, false);
      assert.ok(result.affectedRecords.totalXlmImpact > 0);
      assert.ok(result.confirmationToken.length > 0);

      // Verify side effects and rollback constraints
      assert.ok(result.sideEffects.length >= 2);
      const reversibleRb = result.rollbackConstraints.find((rb) => rb.canRollback);
      assert.ok(reversibleRb);
      assert.ok(reversibleRb.rollbackProcedure?.includes("Restore"));

      // Non-reversible constraint for historical payouts
      const nonReversibleRb = result.rollbackConstraints.find((rb) => !rb.canRollback);
      assert.ok(nonReversibleRb);
    });

    it("simulates price limit ceiling and produces before/after diffs", async () => {
      const result = await simulatePriceLimit(
        { maxPrice: 100 },
        "Cap luxury prompts at 100 XLM",
        POLICY_ACTOR.id,
        { actor: POLICY_ACTOR, candidateRecords: SAMPLE_PROMPTS, secret: TEST_SECRET },
      );

      assert.equal(result.policyChange.type, "price_limit");
      assert.equal(result.affectedCount, 2); // p1 (150) and p3 (200)
      assert.equal(result.affectedRecords.totalXlmImpact, 150); // (150-100) + (200-100)
      assert.equal(result.preview.affectedPreviews.length, 2);

      const p1Preview = result.preview.affectedPreviews.find((p) => p.recordId === "p1");
      assert.ok(p1Preview);
      assert.deepEqual(p1Preview.diffs, [{ field: "priceXlm", before: 150, after: 100 }]);
      assert.equal(p1Preview.isIrreversible, false);
      assert.equal(p1Preview.severity, "medium");
    });

    it("simulates creator suspension and marks listings quarantined or retired", async () => {
      const result = await simulateCreatorSuspension(
        { creatorAddress: "G_ALICE", action: "quarantine" },
        "Terms violation investigation",
        ADMIN_ACTOR.id,
        { actor: ADMIN_ACTOR, candidateRecords: SAMPLE_PROMPTS, secret: TEST_SECRET },
      );

      assert.equal(result.policyChange.type, "creator_suspension");
      assert.equal(result.affectedCount, 2); // p1 and p3 belong to G_ALICE
      assert.equal(result.isIrreversible, false); // quarantine is reversible

      // Test retired action (which is irreversible on Soroban ledger)
      const retiredResult = await simulateCreatorSuspension(
        { creatorAddress: "G_ALICE", action: "retire" },
        "Permanent de-registration",
        ADMIN_ACTOR.id,
        { actor: ADMIN_ACTOR, candidateRecords: SAMPLE_PROMPTS, secret: TEST_SECRET },
      );

      assert.equal(retiredResult.isIrreversible, true);
      assert.equal(retiredResult.severityCounts.critical, 2);
      assert.equal(retiredResult.rollbackConstraints[0].canRollback, false);
    });

    it("simulates bulk refund with treasury impact and irreversible on-chain constraints", async () => {
      const samplePurchases = [
        { id: "pur_1", version: 1, promptId: "p_target", amountXlm: 75, buyerWallet: "G_BUYER1" },
        { id: "pur_2", version: 1, promptId: "p_target", amountXlm: 75, buyerWallet: "G_BUYER2" },
      ];

      const result = await simulateBulkRefund(
        { promptId: "p_target", refundTreasuryReserveXlm: 5000 },
        "Defective prompt recall",
        ADMIN_ACTOR.id,
        { actor: ADMIN_ACTOR, candidateRecords: samplePurchases, secret: TEST_SECRET },
      );

      assert.equal(result.policyChange.type, "bulk_refund");
      assert.equal(result.affectedCount, 2);
      assert.equal(result.affectedRecords.totalXlmImpact, 150);
      assert.equal(result.isIrreversible, true);
      assert.equal(result.rollbackConstraints[0].canRollback, false);
    });

    it("simulates custom rules with composite predicates via dry-run engine", async () => {
      const result = await simulateCustomRule(
        {
          id: "custom-active-cheap",
          name: "Discount Underpriced Prompts",
          targetResource: "prompts",
          predicate: [
            { field: "status", operator: "eq", value: "active" },
            { field: "priceXlm", operator: "lt", value: 50 },
          ],
          action: "price_cap",
          parameters: { maxPrice: 40 },
          requiredPermission: "policy:evaluate",
        },
        { actor: POLICY_ACTOR, candidateRecords: SAMPLE_PROMPTS, secret: TEST_SECRET },
      );

      assert.equal(result.scannedCount, 4);
      assert.equal(result.affectedCount, 1); // p2 (45 XLM, active)
      assert.equal(result.preview.affectedPreviews[0].recordId, "p2");
    });

    it("bounds affected preview window to maxPreview while maintaining total count", async () => {
      const largeSet = Array.from({ length: 30 }, (_, i) => ({
        id: `prompt_${i}`,
        version: 1,
        status: "active",
        priceXlm: 200,
        creatorAddress: "G_SELLER",
      }));

      const result = await simulatePriceLimit(
        { maxPrice: 100 },
        "Cap all prompts",
        ADMIN_ACTOR.id,
        {
          actor: ADMIN_ACTOR,
          candidateRecords: largeSet,
          maxPreview: 5,
          secret: TEST_SECRET,
        },
      );

      assert.equal(result.affectedCount, 30);
      assert.equal(result.preview.affectedPreviews.length, 5); // bounded to 5
    });
  });

  // 2. FAILURE PATHS
  describe("Failure Pathways", () => {
    it("rejects invalid fee percentages (negative or > 1)", async () => {
      await assert.rejects(
        () =>
          simulateFeeAdjustment({ newFeePercentage: -0.05 }, "Invalid fee", ADMIN_ACTOR.id, {
            actor: ADMIN_ACTOR,
          }),
        (err) => err instanceof PolicyEvaluationError && err.code === "invalid_policy",
      );

      await assert.rejects(
        () =>
          simulateFeeAdjustment({ newFeePercentage: 1.5 }, "Invalid fee", ADMIN_ACTOR.id, {
            actor: ADMIN_ACTOR,
          }),
        (err) => err instanceof PolicyEvaluationError && err.code === "invalid_policy",
      );
    });

    it("rejects price limit when minPrice exceeds maxPrice", async () => {
      await assert.rejects(
        () =>
          simulatePriceLimit({ minPrice: 150, maxPrice: 100 }, "Invalid pricing", ADMIN_ACTOR.id, {
            actor: ADMIN_ACTOR,
          }),
        (err) => err instanceof PolicyEvaluationError && err.code === "invalid_policy",
      );
    });

    it("rejects creator suspension when creatorAddress is empty", async () => {
      await assert.rejects(
        () =>
          simulateCreatorSuspension({ creatorAddress: "" }, "Invalid", ADMIN_ACTOR.id, {
            actor: ADMIN_ACTOR,
          }),
        (err) => err instanceof PolicyEvaluationError && err.code === "invalid_policy",
      );
    });

    it("rejects bulk refund when promptId is missing", async () => {
      await assert.rejects(
        () =>
          simulateBulkRefund({ promptId: "" }, "Invalid", ADMIN_ACTOR.id, {
            actor: ADMIN_ACTOR,
          }),
        (err) => err instanceof PolicyEvaluationError && err.code === "invalid_policy",
      );
    });

    it("rejects candidate record sets exceeding MAX_EVALUATION_RECORDS", async () => {
      const records = Array.from({ length: 15 }, (_, i) => ({ id: `p_${i}`, version: 1, priceXlm: 10 }));
      await assert.rejects(
        () =>
          simulatePriceLimit({ maxPrice: 5 }, "Limit", ADMIN_ACTOR.id, {
            actor: ADMIN_ACTOR,
            candidateRecords: records,
            maxRecords: 10,
          }),
        (err) => err instanceof PolicyEvaluationError && err.code === "selection_too_large",
      );
    });

    it("rejects unknown policy change types", async () => {
      await assert.rejects(
        () =>
          simulatePolicyChange(
            {
              type: "unknown_future_policy",
              parameters: {},
              reason: "Test",
              scheduledBy: ADMIN_ACTOR.id,
            },
            { actor: ADMIN_ACTOR },
          ),
        (err) => err instanceof PolicyEvaluationError && err.code === "invalid_policy",
      );
    });
  });

  // 3. RETRY & DRIFT DETECTION PATHS
  describe("Retry & Drift Pathways", () => {
    it("generates deterministic HMAC confirmation tokens for idempotent runs", async () => {
      const run1 = await simulatePriceLimit(
        { maxPrice: 100 },
        "Ceiling",
        POLICY_ACTOR.id,
        { actor: POLICY_ACTOR, candidateRecords: SAMPLE_PROMPTS, secret: TEST_SECRET },
      );

      const run2 = await simulatePriceLimit(
        { maxPrice: 100 },
        "Ceiling",
        POLICY_ACTOR.id,
        { actor: POLICY_ACTOR, candidateRecords: SAMPLE_PROMPTS, secret: TEST_SECRET },
      );

      assert.equal(run1.confirmationToken, run2.confirmationToken);

      // Verify token passes validation
      const valid = verifySimulationConfirmationToken(run1.confirmationToken, run1, TEST_SECRET);
      assert.equal(valid, true);
    });

    it("detects record version drift and rejects stale confirmation tokens", async () => {
      const simulation = await simulatePriceLimit(
        { maxPrice: 100 },
        "Ceiling",
        POLICY_ACTOR.id,
        { actor: POLICY_ACTOR, candidateRecords: SAMPLE_PROMPTS, secret: TEST_SECRET },
      );

      // Valid prior to mutation
      assert.equal(
        verifySimulationConfirmationToken(simulation.confirmationToken, simulation, TEST_SECRET),
        true,
      );

      // Simulate drift: prompt p1 bumped its version from 1 to 2
      const driftedSimulation = {
        ...simulation,
        preview: {
          ...simulation.preview,
          affectedPreviews: simulation.preview.affectedPreviews.map((p) =>
            p.recordId === "p1" ? { ...p, version: p.version + 1 } : p,
          ),
        },
      };

      assert.equal(
        verifySimulationConfirmationToken(simulation.confirmationToken, driftedSimulation, TEST_SECRET),
        false,
      );
    });

    it("detects financial impact tampering and rejects confirmation tokens", async () => {
      const simulation = await simulatePriceLimit(
        { maxPrice: 100 },
        "Ceiling",
        POLICY_ACTOR.id,
        { actor: POLICY_ACTOR, candidateRecords: SAMPLE_PROMPTS, secret: TEST_SECRET },
      );

      const tamperedSimulation = {
        ...simulation,
        affectedRecords: {
          ...simulation.affectedRecords,
          totalXlmImpact: simulation.affectedRecords.totalXlmImpact + 50,
        },
      };

      assert.equal(
        verifySimulationConfirmationToken(simulation.confirmationToken, tamperedSimulation, TEST_SECRET),
        false,
      );
    });
  });

  // 4. AUTHORIZATION PATHS
  describe("Authorization Pathways", () => {
    it("denies policy simulation to actors lacking required permissions", async () => {
      await assert.rejects(
        () =>
          simulatePriceLimit({ maxPrice: 100 }, "Ceiling", UNAUTHORIZED_ACTOR.id, {
            actor: UNAUTHORIZED_ACTOR,
            candidateRecords: SAMPLE_PROMPTS,
          }),
        (err) => err instanceof PolicyEvaluationError && err.code === "unauthorized",
      );
    });

    it("authorizes actors possessing policy:evaluate permission", async () => {
      const result = await simulatePriceLimit({ maxPrice: 100 }, "Ceiling", POLICY_ACTOR.id, {
        actor: POLICY_ACTOR,
        candidateRecords: SAMPLE_PROMPTS,
        secret: TEST_SECRET,
      });

      assert.ok(result.confirmationToken);
    });

    it("authorizes administrative actors", async () => {
      const result = await simulateFeeAdjustment({ newFeePercentage: 0.06 }, "Admin fee", ADMIN_ACTOR.id, {
        actor: ADMIN_ACTOR,
        candidateRecords: SAMPLE_PROMPTS,
        secret: TEST_SECRET,
      });

      assert.ok(result.confirmationToken);
    });
  });

  // 5. CLI RUNNER PATHS
  describe("CLI Tool Pathways", () => {
    it("parses CLI arguments correctly", () => {
      const argv = [
        "node",
        "scripts/policy-simulation.mjs",
        "--policy=price_limit",
        "--param.maxPrice=100",
        "--param.minPrice=10",
        "--actor=test-actor",
        "--permissions=policy:evaluate,admin",
        "--format=json",
      ];

      const parsed = parseCliArgs(argv);
      assert.equal(parsed.policy, "price_limit");
      assert.equal(parsed.parameters.maxPrice, 100);
      assert.equal(parsed.parameters.minPrice, 10);
      assert.equal(parsed.actor, "test-actor");
      assert.equal(parsed.permissions, "policy:evaluate,admin");
      assert.equal(parsed.format, "json");
    });

    it("executes CLI simulation successfully and returns code 0", async () => {
      const argv = [
        "node",
        "scripts/policy-simulation.mjs",
        "--policy=fee_adjustment",
        "--param.newFeePercentage=0.07",
        "--format=json",
      ];

      const res = await runPolicySimulationCli(argv);
      assert.equal(res.exitCode, 0);
      assert.ok(res.result);
      assert.equal(res.result.policyChange.type, "fee_adjustment");
    });

    it("returns exit code 2 when actor is unauthorized in CLI", async () => {
      const argv = [
        "node",
        "scripts/policy-simulation.mjs",
        "--policy=fee_adjustment",
        "--param.newFeePercentage=0.07",
        "--permissions=unprivileged_scope",
      ];

      const res = await runPolicySimulationCli(argv);
      assert.equal(res.exitCode, 2);
      assert.equal(res.error, "unauthorized");
    });

    it("returns exit code 1 when policy parameters are invalid in CLI", async () => {
      const argv = [
        "node",
        "scripts/policy-simulation.mjs",
        "--policy=fee_adjustment",
        "--param.newFeePercentage=-0.5",
      ];

      const res = await runPolicySimulationCli(argv);
      assert.equal(res.exitCode, 1);
      assert.equal(res.error, "invalid_policy");
    });

    it("verifies confirmation tokens and detects drift in CLI", async () => {
      // 1. Run simulation to get token
      const simArgv = [
        "node",
        "scripts/policy-simulation.mjs",
        "--policy=fee_adjustment",
        "--param.newFeePercentage=0.06",
        "--format=json",
      ];
      const simRes = await runPolicySimulationCli(simArgv);
      const token = simRes.result.confirmationToken;

      // 2. Verify matching token succeeds
      const verifyArgv = [
        "node",
        "scripts/policy-simulation.mjs",
        "--policy=fee_adjustment",
        "--param.newFeePercentage=0.06",
        `--verify-token=${token}`,
      ];
      const verifyRes = await runPolicySimulationCli(verifyArgv);
      assert.equal(verifyRes.exitCode, 0);
      assert.equal(verifyRes.valid, true);

      // 3. Verify mismatch fails with exit code 3
      const badVerifyArgv = [
        "node",
        "scripts/policy-simulation.mjs",
        "--policy=fee_adjustment",
        "--param.newFeePercentage=0.06",
        "--verify-token=0000000000000000000000000000000000000000000000000000000000000000",
      ];
      const badVerifyRes = await runPolicySimulationCli(badVerifyArgv);
      assert.equal(badVerifyRes.exitCode, 3);
      assert.equal(badVerifyRes.valid, false);
    });
  });
});
