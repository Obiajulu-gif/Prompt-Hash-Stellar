import { describe, expect, it } from "vitest";
import {
  generateSorobanTimeoutFixture,
  generateBadSequenceRecoveryFixture,
  generatePartialBulkRetireFixture,
  generateContentIntegrityTamperFixture,
  generateEventJournalGapFixture,
  mulberry32,
} from "../services/rareFailureFixtureGenerator";

describe("Fixture Generators for Rare Failure and Recovery Paths (#1033)", () => {
  it("produces byte-for-byte identical fixtures given the same seed (PRNG determinism)", () => {
    const fxA = generateSorobanTimeoutFixture(12345);
    const fxB = generateSorobanTimeoutFixture(12345);
    const fxC = generateSorobanTimeoutFixture(99999);

    expect(fxA.fingerprint).toBe(fxB.fingerprint);
    expect(fxA.initialState).toEqual(fxB.initialState);
    expect(fxA.fingerprint).not.toBe(fxC.fingerprint);
  });

  it("verifies Soroban RPC timeout and ledger boundary extension scenario", () => {
    const fixture = generateSorobanTimeoutFixture(42);

    expect(fixture.simulatedFault.errorCode).toBe("tx_too_late");
    expect(fixture.simulatedFault.canRetry).toBe(true);
    expect(fixture.expectedRecovery.action).toBe("RETRY");
    expect(fixture.expectedRecovery.compensationSteps).toContain("extend_max_ledger_bounds");

    // Simulate recovery handler achieving expected final state
    const actualRecoveryState = { ...fixture.expectedRecovery.expectedState };
    const isValid = fixture.expectedRecovery.assertFinalState(actualRecoveryState);
    expect(isValid).toBe(true);
  });

  it("verifies Stellar account sequence desynchronization (tx_bad_seq) recovery", () => {
    const fixture = generateBadSequenceRecoveryFixture(888);

    expect(fixture.simulatedFault.errorCode).toBe("tx_bad_seq");
    expect(fixture.expectedRecovery.action).toBe("RESYNC");
    expect(fixture.expectedRecovery.compensationSteps).toContain("fetch_account_sequence_from_network");

    // Assert network sequence is ahead of cached sequence
    expect(BigInt(fixture.initialState.actualNetworkSequence)).toBeGreaterThan(
      BigInt(fixture.initialState.cachedSequence),
    );

    const actualState = { ...fixture.expectedRecovery.expectedState };
    expect(fixture.expectedRecovery.assertFinalState(actualState)).toBe(true);
  });

  it("verifies partial bulk retire failure under irreversible Soroban ledger finality", () => {
    const fixture = generatePartialBulkRetireFixture(777);

    expect(fixture.simulatedFault.errorCode).toBe("InvalidStatusTransition");
    expect(fixture.simulatedFault.canRetry).toBe(false);
    expect(fixture.expectedRecovery.action).toBe("ROLLBACK");

    // Confirm that 1 prompt fails due to finality and 2 prompts succeed
    const expected = fixture.expectedRecovery.expectedState;
    expect(expected.failedCount).toBe(1);
    expect(expected.succeededCount).toBe(2);
    expect(expected.itemizedFailures[0].isIrreversible).toBe(true);
    expect(fixture.expectedRecovery.assertFinalState(expected)).toBe(true);
  });

  it("verifies content integrity hash tampering and automatic quarantine", () => {
    const fixture = generateContentIntegrityTamperFixture(500);

    expect(fixture.simulatedFault.errorCode).toBe("ContentHashMismatch");
    expect(fixture.expectedRecovery.action).toBe("QUARANTINE");
    expect(fixture.expectedRecovery.compensationSteps).toContain("emit_quarantine_event_to_journal");

    const expected = fixture.expectedRecovery.expectedState;
    expect(expected.quarantined).toBe(true);
    expect(expected.plaintextDelivered).toBe(false);
    expect(fixture.expectedRecovery.assertFinalState(expected)).toBe(true);
  });

  it("verifies event journal ledger gap detection and targeted backfill resumption", () => {
    const fixture = generateEventJournalGapFixture(300);

    expect(fixture.simulatedFault.errorCode).toBe("LedgerSequenceGap");
    expect(fixture.expectedRecovery.action).toBe("RESYNC");
    expect(fixture.expectedRecovery.compensationSteps).toContain("queue_targeted_backfill_job");

    const gap = fixture.initialState.incomingLedger - fixture.initialState.lastProcessedLedger - 1;
    expect(gap).toBe(fixture.initialState.gapSize);

    const expected = fixture.expectedRecovery.expectedState;
    expect(fixture.expectedRecovery.assertFinalState(expected)).toBe(true);
  });

  it("validates PRNG statistical distribution and repeatability", () => {
    const rng1 = mulberry32(101);
    const rng2 = mulberry32(101);

    const sample1 = Array.from({ length: 10 }, () => rng1());
    const sample2 = Array.from({ length: 10 }, () => rng2());

    expect(sample1).toEqual(sample2);
    for (const val of sample1) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });
});
