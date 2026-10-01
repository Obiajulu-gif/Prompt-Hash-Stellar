import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OperationRecoveryService } from "../services/operationRecoveryService";
import { OperationCheckpoint } from "../models/OperationCheckpoint";

describe("OperationRecoveryService (Issue #831)", () => {
  beforeEach(async () => {
    await OperationCheckpoint.deleteMany({});
  });

  afterEach(async () => {
    await OperationCheckpoint.deleteMany({});
  });

  it("initiates a new operation checkpoint with idempotency guarantee", async () => {
    const key = "idem_tx_12345";
    const res1 = await OperationRecoveryService.initiateOperation({
      operationType: "PROMPT_PURCHASE",
      userId: "user_buyer_1",
      idempotencyKey: key,
      initialStep: "VALIDATE_BALANCE",
      payload: { promptId: "prompt_99", amountStroops: 5000000 },
    });

    expect(res1.isNew).toBe(true);
    expect(res1.checkpoint.overallState).toBe("INITIALIZED");
    expect(res1.checkpoint.currentStep).toBe("VALIDATE_BALANCE");

    // Second call with same idempotency key returns existing
    const res2 = await OperationRecoveryService.initiateOperation({
      operationType: "PROMPT_PURCHASE",
      userId: "user_buyer_1",
      idempotencyKey: key,
      initialStep: "VALIDATE_BALANCE",
    });

    expect(res2.isNew).toBe(false);
    expect(res2.checkpoint.operationId).toBe(res1.checkpoint.operationId);
  });

  it("records progress and updates checkpoint steps", async () => {
    const { checkpoint } = await OperationRecoveryService.initiateOperation({
      operationType: "PROMPT_PURCHASE",
      userId: "user_buyer_2",
      idempotencyKey: "idem_step_test",
      initialStep: "VALIDATE_BALANCE",
    });

    const updated = await OperationRecoveryService.recordStep(
      checkpoint.operationId,
      "BROADCAST_TRANSACTION",
      "ONCHAIN_SUBMITTED",
      { txHash: "0xabc123456789" }
    );

    expect(updated.currentStep).toBe("BROADCAST_TRANSACTION");
    expect(updated.overallState).toBe("ONCHAIN_SUBMITTED");
    expect(updated.steps).toHaveLength(2);
    expect(updated.steps[1].txHash).toBe("0xabc123456789");
  });

  it("evaluates recovery safely when interrupted with on-chain transaction", async () => {
    const { checkpoint } = await OperationRecoveryService.initiateOperation({
      operationType: "PROMPT_PURCHASE",
      userId: "user_buyer_3",
      idempotencyKey: "idem_eval_onchain",
      initialStep: "VALIDATE_BALANCE",
    });

    await OperationRecoveryService.recordStep(
      checkpoint.operationId,
      "SUBMIT_SOROBAN_TX",
      "ONCHAIN_SUBMITTED",
      { txHash: "0xstellar_tx_999" }
    );

    const plan = await OperationRecoveryService.evaluateRecovery(checkpoint.operationId);
    expect(plan.canResume).toBe(true);
    expect(plan.resumeStep).toBe("VERIFY_ONCHAIN_STATUS");
    expect(plan.instructions).toContain("0xstellar_tx_999");
  });

  it("resumes interrupted operation and increments retry count", async () => {
    const { checkpoint } = await OperationRecoveryService.initiateOperation({
      operationType: "PROMPT_PUBLISH",
      userId: "user_creator_1",
      idempotencyKey: "idem_resume_test",
      initialStep: "IPFS_UPLOAD",
    });

    const resumed = await OperationRecoveryService.resumeOperation(checkpoint.operationId);
    expect(resumed.retryCount).toBe(1);
    expect(resumed.overallState).toBe("RECOVERABLE");
  });

  it("finds stuck operations older than threshold and supports maintainer override", async () => {
    const { checkpoint } = await OperationRecoveryService.initiateOperation({
      operationType: "ESCROW_RELEASE",
      userId: "user_seller_1",
      idempotencyKey: "idem_stuck_test",
      initialStep: "ESCROW_LOCK",
    });

    // Artificially age the record
    await OperationCheckpoint.updateOne(
      { operationId: checkpoint.operationId },
      { updatedAt: new Date(Date.now() - 40 * 60 * 1000) }
    );

    const stuck = await OperationRecoveryService.findStuckOperations(30);
    expect(stuck.some((s) => s.operationId === checkpoint.operationId)).toBe(true);

    const resolved = await OperationRecoveryService.forceResolveOperation(
      checkpoint.operationId,
      "MARK_CONFIRMED",
      "maintainer_admin_01",
      "Verified on-chain manually via explorer"
    );

    expect(resolved.overallState).toBe("CONFIRMED");
  });
});
