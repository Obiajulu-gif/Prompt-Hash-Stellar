import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import TransferRun from "../models/TransferRun";
import { OperationCheckpoint } from "../models/OperationCheckpoint";
import {
  beginTransfer,
  cancelTransfer,
  getTransfer,
  TransferCancelledError,
  TransferError,
} from "../services/transferExecution";
import { OperationRecoveryService } from "../services/operationRecoveryService";
import {
  failBefore,
  loseResponseAfter,
  scriptedFaults,
  InjectedFault,
} from "./helpers/faultInjector";

/**
 * Issue #1136: Deterministic Rollback Tests for Failed External Side Effects.
 *
 * Verifies that when operations trigger external side effects (e.g. Soroban
 * contract calls, Horizon RPC broadcasts, or outbound webhook notifications):
 *   - Normal path: external effect succeeds and commits atomically.
 *   - Pre-execution failure: state rolls back cleanly with zero orphaned writes.
 *   - Post-execution response drop (at-least-once): retry recognizes prepared
 *     reference and does not duplicate external side effects.
 *   - Retry path: safe resumption using deterministic input hashes.
 *   - Authorization path: tenant isolation and scoped permission enforcement.
 */

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await TransferRun.init();
  await OperationCheckpoint.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await TransferRun.deleteMany({});
  await OperationCheckpoint.deleteMany({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Deterministic Rollback for External Side Effects (Issue #1136)", () => {
  describe("Transfer Execution Engine External Side Effects", () => {
    it("normal path: executes external effect, commits checkpoint, and finalizes run", async () => {
      let externalCallCount = 0;
      const fakeExternalCall = async (payload: { xlmAmount: number }) => {
        externalCallCount++;
        return { txHash: "0xstellar_valid_hash_1136", stroops: payload.xlmAmount * 10000000 };
      };

      const execution = await beginTransfer("creator_alice", "export", { promptId: "p_100" });

      const result = await execution.step("soroban_payout", "tx_ref_001", async () => {
        return fakeExternalCall({ xlmAmount: 5 });
      });

      expect(result.txHash).toBe("0xstellar_valid_hash_1136");
      expect(externalCallCount).toBe(1);

      await execution.finish("completed");
      const saved = await getTransfer(execution.id, "creator_alice");
      expect(saved.status).toBe("completed");
      expect(saved.steps.soroban_payout.state).toBe("committed");
      expect(saved.steps.soroban_payout.reference).toBe("tx_ref_001");
    });

    it("pre-execution failure: rolls back step state when external network drops before execution", async () => {
      let externalExecuted = false;
      const faultyExternalCall = failBefore(
        async () => {
          externalExecuted = true;
          return { txHash: "0xnever" };
        },
        scriptedFaults(["network"]),
      );

      const execution = await beginTransfer("creator_alice", "export", { promptId: "p_101" });

      // Step execution should fail with InjectedFault
      await expect(
        execution.step("soroban_escrow_release", "escrow_ref_fail", async () => {
          return faultyExternalCall();
        }),
      ).rejects.toBeInstanceOf(InjectedFault);

      // Verify the external effect was NEVER run
      expect(externalExecuted).toBe(false);

      // Finish as failed
      await execution.finish("failed");

      const saved = await getTransfer(execution.id, "creator_alice");
      expect(saved.status).toBe("failed");
      // Step prepared evidence is retained for operator diagnostics, not committed
      expect(saved.steps.soroban_escrow_release.state).toBe("prepared");
    });

    it("post-execution response loss: handles at-least-once dropped response deterministically without duplicate side effects", async () => {
      let externalCallAttempts = 0;
      const externalLedgerState = new Map<string, string>();

      // Idempotent external call simulator: checks reference before mutating
      const idempotentExternalCall = async (ref: string, amount: number) => {
        externalCallAttempts++;
        if (externalLedgerState.has(ref)) {
          return { status: "already_committed", txHash: externalLedgerState.get(ref)! };
        }
        const txHash = `0xstellar_tx_${ref}`;
        externalLedgerState.set(ref, txHash);
        return { status: "newly_created", txHash, amount };
      };

      // Fails with "timeout" after the first call commits, but passes on subsequent call
      const schedule = scriptedFaults(["timeout", "ok"]);
      const flakyCall = loseResponseAfter(idempotentExternalCall, schedule);

      const execution = await beginTransfer("buyer_bob", "import", { batch: "wave_1" });

      // Attempt 1: Side effect runs and commits on remote system, but response is dropped
      await expect(
        execution.step("external_mint", "ref_deterministic_123", async () => {
          return flakyCall("ref_deterministic_123", 50);
        }),
      ).rejects.toBeInstanceOf(InjectedFault);

      expect(externalCallAttempts).toBe(1);
      expect(externalLedgerState.has("ref_deterministic_123")).toBe(true);
      await execution.finish("failed");

      // Attempt 2: Retry with identical input and token reference
      const retry = await beginTransfer(
        "buyer_bob",
        "import",
        { batch: "wave_1" },
        execution.id,
      );

      const retryResult = await retry.step("external_mint", "ref_deterministic_123", async () => {
        return flakyCall("ref_deterministic_123", 50);
      });

      expect(retryResult.status).toBe("already_committed");
      expect(externalCallAttempts).toBe(2); // Attempted query
      expect(externalLedgerState.size).toBe(1); // BUT remote state was not duplicated!

      await retry.finish("completed");
      const final = await getTransfer(execution.id, "buyer_bob");
      expect(final.status).toBe("completed");
      expect(final.steps.external_mint.state).toBe("committed");
    });

    it("retry path: rejects retry when input has drifted", async () => {
      const execution = await beginTransfer("creator_alice", "export", { version: 1 });
      await execution.finish("failed");

      // Resuming with modified input is strictly rejected
      await expect(
        beginTransfer("creator_alice", "export", { version: 2 }, execution.id),
      ).rejects.toThrow("Transfer kind or input changed; create a new transfer");
    });

    it("authorization path: denies cross-tenant access to external side effect runs", async () => {
      const execution = await beginTransfer("creator_alice", "export", { key: "secret" });

      // Bob cannot view or resume Alice's transfer execution
      await expect(getTransfer(execution.id, "mallory")).rejects.toBeInstanceOf(TransferError);
      await expect(
        beginTransfer("mallory", "export", { key: "secret" }, execution.id),
      ).rejects.toThrow("Transfer not found");

      await execution.finish("cancelled");
    });
  });

  describe("Operation Recovery Service External Side Effects", () => {
    it("recovers safely from interrupted on-chain submission without duplicated broadcasts", async () => {
      const key = "idem_external_side_effect_test";
      const { checkpoint } = await OperationRecoveryService.initiateOperation({
        operationType: "PROMPT_PURCHASE",
        userId: "user_buyer_99",
        idempotencyKey: key,
        initialStep: "CHECK_BALANCE",
        payload: { promptId: "123", priceStroops: 10000000 },
      });

      // Advance to on-chain submission
      await OperationRecoveryService.recordStep(
        checkpoint.operationId,
        "BROADCAST_SOROBAN_TRANSACTION",
        "ONCHAIN_SUBMITTED",
        { txHash: "0xsoroban_tx_abc_1136" },
      );

      // Evaluate recovery plan: must verify status on-chain before attempting any new side effects
      const recoveryPlan = await OperationRecoveryService.evaluateRecovery(checkpoint.operationId);
      expect(recoveryPlan.canResume).toBe(true);
      expect(recoveryPlan.resumeStep).toBe("VERIFY_ONCHAIN_STATUS");
      expect(recoveryPlan.instructions).toContain("0xsoroban_tx_abc_1136");
      expect(recoveryPlan.recommendedAction).toBe("RETRY");
    });

    it("recommends safe rollback when interrupted at pre-broadcast stage", async () => {
      const { checkpoint } = await OperationRecoveryService.initiateOperation({
        operationType: "PROMPT_PURCHASE",
        userId: "user_buyer_100",
        idempotencyKey: "idem_pre_broadcast",
        initialStep: "VALIDATE_ALLOWLIST",
      });

      // Stalled before any external side effects occurred
      await OperationRecoveryService.recordStep(
        checkpoint.operationId,
        "VALIDATE_ALLOWLIST",
        "FAILED",
        undefined,
        "Allowlist check failed",
      );

      const recoveryPlan = await OperationRecoveryService.evaluateRecovery(checkpoint.operationId);
      expect(recoveryPlan.instructions).toContain("no external on-chain side effects were recorded");
    });
  });
});

