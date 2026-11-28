import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import ExternalSideEffectCheckpoint from "../models/ExternalSideEffectCheckpoint";
import {
  isAmbiguousSideEffectError,
  listUnresolvedSideEffects,
  reconcileSideEffect,
  rollbackSideEffect,
  runDurableSideEffect,
  SideEffectCheckpointError,
} from "../services/durableSideEffectCheckpoint";

/**
 * Issue #1175: durable checkpoints around external side effects.
 *
 * Covers the acceptance paths:
 *   - normal: one dispatch, checkpoint committed
 *   - failure: pre-dispatch failure stays retryable, no duplicate effects
 *   - retry: committed effects replay without dispatch, failed ones reuse the
 *     same deterministic reference
 *   - ambiguity: lost responses are quarantined and reconciled, never replayed
 *     blindly
 *   - authorization: denied and cross-actor attempts never dispatch
 *   - compensation: rollback commits only when the compensating action succeeds
 */

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await ExternalSideEffectCheckpoint.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await ExternalSideEffectCheckpoint.deleteMany({});
});

const base = {
  operationType: "PAYOUT_DISTRIBUTION" as const,
  operationId: "op_payout_1175",
  effectKey: "soroban_payout",
  actorId: "creator_alice",
  payload: { promptId: "p_1175", amountStroops: 50_000_000 },
};

async function checkpoint(overrides: Record<string, unknown> = {}) {
  return ExternalSideEffectCheckpoint.findOne({
    operationId: base.operationId,
    effectKey: base.effectKey,
    ...overrides,
  });
}

describe("durable side-effect checkpoints (issue #1175)", () => {
  it("normal path commits a durable checkpoint with a deterministic reference", async () => {
    const calls: string[] = [];
    const result = await runDurableSideEffect({
      ...base,
      effect: async ({ externalReference }) => {
        calls.push(externalReference);
        return { txHash: "0xstellar_payout_1175" };
      },
      describeResult: (value) => ({ txHash: value.txHash, summary: { amount: 5 } }),
    });

    expect(result.outcome).toBe("executed");
    expect(result.result?.txHash).toBe("0xstellar_payout_1175");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^se_[a-f0-9]{32}$/);

    const saved = await checkpoint();
    expect(saved?.state).toBe("COMMITTED");
    expect(saved?.txHash).toBe("0xstellar_payout_1175");
    expect(saved?.resultSummary).toEqual({ amount: 5 });
    expect(saved?.externalReference).toBe(calls[0]);
    expect(saved?.attemptCount).toBe(1);
    expect(saved?.history.map((entry) => entry.state)).toEqual([
      "IN_PROGRESS",
      "COMMITTED",
    ]);
  });

  it("replays a committed effect without dispatching again", async () => {
    let dispatches = 0;
    const effect = async () => {
      dispatches += 1;
      return { txHash: "0xonce" };
    };

    await runDurableSideEffect({ ...base, effect });
    const replay = await runDurableSideEffect({ ...base, effect });

    expect(replay.outcome).toBe("replayed");
    expect(replay.checkpoint.state).toBe("COMMITTED");
    expect(dispatches).toBe(1);
  });

  it("keeps pre-dispatch failures retryable and reuses the same reference", async () => {
    let dispatches = 0;
    const references: string[] = [];

    await expect(
      runDurableSideEffect({
        ...base,
        effect: async ({ externalReference }) => {
          dispatches += 1;
          references.push(externalReference);
          throw new Error("connection refused before dispatch");
        },
      }),
    ).rejects.toThrow("connection refused before dispatch");

    const failed = await checkpoint();
    expect(failed?.state).toBe("FAILED");
    expect(failed?.attemptCount).toBe(1);

    const retry = await runDurableSideEffect({
      ...base,
      effect: async ({ externalReference }) => {
        dispatches += 1;
        references.push(externalReference);
        return { txHash: "0xretry" };
      },
    });

    expect(retry.outcome).toBe("executed");
    expect(dispatches).toBe(2);
    expect(references[0]).toBe(references[1]);
    const committed = await checkpoint();
    expect(committed?.state).toBe("COMMITTED");
    expect(committed?.attemptCount).toBe(2);
  });

  it("quarantines an ambiguous response and requires reconciliation before retry", async () => {
    let dispatches = 0;
    const lostResponse = async () => {
      dispatches += 1;
      throw Object.assign(new Error("socket hang up after write"), {
        code: "ECONNRESET",
      });
    };

    await expect(runDurableSideEffect({ ...base, effect: lostResponse })).rejects.toMatchObject({
      code: "SIDE_EFFECT_AMBIGUOUS",
    });
    expect((await checkpoint())?.state).toBe("AMBIGUOUS");

    // A retry never re-dispatches an ambiguous effect.
    await expect(runDurableSideEffect({ ...base, effect: lostResponse })).rejects.toMatchObject({
      code: "SIDE_EFFECT_AMBIGUOUS",
    });
    expect(dispatches).toBe(1);

    const reconciled = await reconcileSideEffect({
      operationId: base.operationId,
      effectKey: base.effectKey,
      operatorId: "maintainer_ops",
      reason: "Checked Horizon: transaction not found.",
      outcome: "NOT_APPLIED",
    });
    expect(reconciled.state).toBe("FAILED");
    expect(reconciled.reconciledBy).toBe("maintainer_ops");

    const retry = await runDurableSideEffect({
      ...base,
      effect: async () => {
        dispatches += 1;
        return { txHash: "0xafterreconcile" };
      },
    });
    expect(retry.outcome).toBe("executed");
    expect(dispatches).toBe(2);
  });

  it("reconciliation as COMMITTED turns a retry into a replay", async () => {
    await expect(
      runDurableSideEffect({
        ...base,
        effect: async () => {
          throw new Error("request timed out");
        },
      }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_AMBIGUOUS" });

    const reconciled = await reconcileSideEffect({
      operationId: base.operationId,
      effectKey: base.effectKey,
      operatorId: "maintainer_ops",
      reason: "Verified tx 0xabc on-chain.",
      outcome: "COMMITTED",
      txHash: "0xabc",
    });
    expect(reconciled.state).toBe("COMMITTED");
    expect(reconciled.txHash).toBe("0xabc");

    let dispatched = false;
    const replay = await runDurableSideEffect({
      ...base,
      effect: async () => {
        dispatched = true;
        return { txHash: "0xshouldnotrun" };
      },
    });
    expect(replay.outcome).toBe("replayed");
    expect(dispatched).toBe(false);
  });

  it("requires a justification for reconciliation", async () => {
    await expect(
      runDurableSideEffect({
        ...base,
        effect: async () => {
          throw new Error("timeout");
        },
      }),
    ).rejects.toBeInstanceOf(SideEffectCheckpointError);

    await expect(
      reconcileSideEffect({
        operationId: base.operationId,
        effectKey: base.effectKey,
        operatorId: "maintainer_ops",
        reason: "   ",
        outcome: "NOT_APPLIED",
      }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_RECONCILE_INVALID" });
  });

  it("denies unauthorized actors without dispatching, then allows an authorized retry", async () => {
    let dispatches = 0;
    const effect = async () => {
      dispatches += 1;
      return { txHash: "0xauthorized" };
    };

    await expect(
      runDurableSideEffect({ ...base, authorize: () => false, effect }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_AUTHORIZATION_DENIED" });

    expect(dispatches).toBe(0);
    const denied = await checkpoint();
    expect(denied?.state).toBe("DENIED");
    expect(denied?.attemptCount).toBe(0);

    const allowed = await runDurableSideEffect({ ...base, authorize: () => true, effect });
    expect(allowed.outcome).toBe("executed");
    expect(dispatches).toBe(1);
  });

  it("denies a different actor reusing the same operation and effect key", async () => {
    await runDurableSideEffect({
      ...base,
      effect: async () => ({ txHash: "0xalice" }),
    });

    await expect(
      runDurableSideEffect({
        ...base,
        actorId: "mallory",
        effect: async () => ({ txHash: "0xmallory" }),
      }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_AUTHORIZATION_DENIED" });
  });

  it("rejects a retry whose input drifted instead of reusing the reference", async () => {
    await runDurableSideEffect({
      ...base,
      externalReference: "ref_fixed_1175",
      effect: async () => ({ txHash: "0xfixed" }),
    });

    await expect(
      runDurableSideEffect({
        ...base,
        externalReference: "ref_changed_1175",
        effect: async () => ({ txHash: "0xother" }),
      }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_REFERENCE_DRIFT" });
  });

  it("reports an active lease as in progress and a crashed lease as ambiguous", async () => {
    const effect = async () => ({ txHash: "0xlease" });

    await ExternalSideEffectCheckpoint.create({
      ...base,
      externalReference: "ref_lease_1175",
      requestHash: "hash_lease_1175",
      state: "IN_PROGRESS",
      attemptToken: "token_live",
      attemptCount: 1,
      leasedUntil: new Date(Date.now() + 60_000),
      history: [{ state: "IN_PROGRESS", at: new Date() }],
    });

    await expect(
      runDurableSideEffect({ ...base, externalReference: "ref_lease_1175", effect }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_IN_PROGRESS" });

    await ExternalSideEffectCheckpoint.updateOne(
      { operationId: base.operationId, effectKey: base.effectKey },
      { $set: { leasedUntil: new Date(Date.now() - 60_000) } },
    );

    await expect(
      runDurableSideEffect({ ...base, externalReference: "ref_lease_1175", effect }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_AMBIGUOUS" });

    const quarantined = await checkpoint();
    expect(quarantined?.state).toBe("AMBIGUOUS");
    expect(await listUnresolvedSideEffects({ operationId: base.operationId })).toHaveLength(1);
  });

  it("rolls back a committed effect and blocks reference reuse afterwards", async () => {
    const compensated: string[] = [];
    await runDurableSideEffect({
      ...base,
      effect: async () => ({ txHash: "0xrollback_me" }),
    });

    const rolledBack = await rollbackSideEffect({
      operationId: base.operationId,
      effectKey: base.effectKey,
      actorId: base.actorId,
      reason: "Downstream entitlement write failed.",
      compensate: async (row) => {
        compensated.push(row.txHash ?? "missing");
      },
    });

    expect(rolledBack.state).toBe("ROLLED_BACK");
    expect(compensated).toEqual(["0xrollback_me"]);

    await expect(
      runDurableSideEffect({ ...base, effect: async () => ({ txHash: "0xagain" }) }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_ROLLED_BACK" });

    // Retrying the compensation is idempotent.
    const again = await rollbackSideEffect({
      operationId: base.operationId,
      effectKey: base.effectKey,
      actorId: base.actorId,
      reason: "Repeat request.",
      compensate: async () => {
        throw new Error("must not run twice");
      },
    });
    expect(again.state).toBe("ROLLED_BACK");
  });

  it("keeps the effect committed when compensation fails", async () => {
    await runDurableSideEffect({
      ...base,
      effect: async () => ({ txHash: "0xstuck" }),
    });

    await expect(
      rollbackSideEffect({
        operationId: base.operationId,
        effectKey: base.effectKey,
        actorId: base.actorId,
        reason: "Compensation drill.",
        compensate: async () => {
          throw new Error("refund endpoint unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_ROLLBACK_FAILED" });

    const saved = await checkpoint();
    expect(saved?.state).toBe("COMMITTED");
    expect(saved?.rollbackError).toContain("refund endpoint unavailable");
  });

  it("denies rollback by a different actor", async () => {
    await runDurableSideEffect({
      ...base,
      effect: async () => ({ txHash: "0xmine" }),
    });

    await expect(
      rollbackSideEffect({
        operationId: base.operationId,
        effectKey: base.effectKey,
        actorId: "mallory",
        reason: "Attempted takeover.",
        compensate: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_AUTHORIZATION_DENIED" });
  });

  it("stops retrying once the attempt budget is exhausted", async () => {
    const failingEffect = async () => {
      throw new Error("validation rejected the payout");
    };

    await expect(
      runDurableSideEffect({ ...base, maxAttempts: 1, effect: failingEffect }),
    ).rejects.toThrow("validation rejected the payout");

    await expect(
      runDurableSideEffect({ ...base, maxAttempts: 1, effect: failingEffect }),
    ).rejects.toMatchObject({ code: "SIDE_EFFECT_ATTEMPTS_EXHAUSTED" });
  });

  it("classifies transport failures as ambiguous but not validation failures", () => {
    expect(isAmbiguousSideEffectError(Object.assign(new Error("boom"), { code: "ETIMEDOUT" }))).toBe(
      true,
    );
    expect(isAmbiguousSideEffectError(new Error("request timeout"))).toBe(true);
    expect(isAmbiguousSideEffectError(new Error("400 invalid destination"))).toBe(false);
  });
});
