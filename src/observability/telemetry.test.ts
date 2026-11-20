import { describe, expect, it, beforeEach } from "vitest";
import { TelemetryService } from "./telemetry";

describe("TelemetryService with High-Cardinality Redaction & Sampling (#1131)", () => {
  let telemetry: TelemetryService;

  beforeEach(() => {
    telemetry = new TelemetryService({
      defaultSuccessSampleRate: 1.0,
      maxBufferSize: 100,
    });
  });

  describe("Normal Path & Base Telemetry", () => {
    it("records structured telemetry for core operations with latency, correlation ID and sample weights", () => {
      const start = Date.now() - 45; // simulate 45ms elapsed
      const event = telemetry.record(
        "prompt-verification",
        "CREATOR",
        "SUCCESS",
        start,
        "corr-xyz-123",
        { promptId: "p-99", stellarTxHash: "tx-abc" }
      );

      expect(event.operation).toBe("prompt-verification");
      expect(event.actorType).toBe("CREATOR");
      expect(event.result).toBe("SUCCESS");
      expect(event.latencyMs).toBeGreaterThanOrEqual(40);
      expect(event.correlationId).toBe("corr-xyz-123");
      expect(event.timestamp).toBeDefined();
      expect(event.sampled).toBe(true);
      expect(event.sampleRate).toBe(1.0);
      expect(event.sampleWeight).toBe(1.0);
    });

    it("validates telemetry covers all 5 core operations", () => {
      const ops = [
        "prompt-verification",
        "wallet-connect",
        "escrow-settlement",
        "prompt-purchase",
        "data-export",
      ] as const;

      ops.forEach((op, idx) => {
        telemetry.record(op, "SYSTEM", "SUCCESS", Date.now() - 10, `corr-${idx}`);
      });

      const recorded = telemetry.getEvents();
      expect(recorded.length).toBe(5);
      ops.forEach((op) => {
        expect(recorded.some((e) => e.operation === op)).toBe(true);
      });
    });
  });

  describe("High-Cardinality Redaction Path", () => {
    it("redacts sensitive keywords and Stellar secret keys", () => {
      const event = telemetry.record(
        "wallet-connect",
        "BUYER",
        "FAILURE",
        Date.now(),
        "corr-sec-999",
        {
          walletAddress: "GBC...",
          secretKey: "S_SUPER_SECRET_KEY_123",
          internalSecret: "token-xyz",
          rawSecretKey: "SBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        }
      );

      expect(event.metadata?.walletAddress).toBe("GBC...");
      expect(event.metadata?.secretKey).toBe("[REDACTED]");
      expect(event.metadata?.internalSecret).toBe("[REDACTED]");
      expect(event.metadata?.rawSecretKey).toBe("[REDACTED]");
    });

    it("masks full 56-char Stellar public addresses and 64-char transaction hashes", () => {
      const fullStellarAddress = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
      const fullContractAddress = "CA3D5KRYMCMCZVAC7SCAGPHCMHRRAKU6LXTYQUQOIVR2EWV5VWBW5XZZ";
      const fullTxHash = "a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
      const testUuid = "123e4567-e89b-12d3-a456-426614174000";

      const event = telemetry.record(
        "prompt-purchase",
        "BUYER",
        "SUCCESS",
        Date.now(),
        "corr-hc-1",
        {
          stellarAccount: fullStellarAddress,
          contractId: fullContractAddress,
          tx: fullTxHash,
          requestId: testUuid,
        }
      );

      // Masked middle
      expect(event.metadata?.stellarAccount).toBe("GBRP...OX2H");
      expect(event.metadata?.contractId).toBe("CA3D...5XZZ");
      expect(event.metadata?.tx).toBe("a1b2c3...4b5c6d");
      expect(event.metadata?.requestId).toBe("[UUID]");
    });

    it("handles deeply nested metadata objects and arrays recursively", () => {
      const event = telemetry.record(
        "escrow-settlement",
        "ADMIN",
        "SUCCESS",
        Date.now(),
        "corr-nested",
        {
          level1: {
            level2: {
              secretToken: "super-secret-nested",
              address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
            },
            list: ["safe", "SC22KABCDEFGHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7Q"],
          },
        }
      );

      const meta = event.metadata as any;
      expect(meta.level1.level2.secretToken).toBe("[REDACTED]");
      expect(meta.level1.level2.address).toBe("GBRP...OX2H");
      expect(meta.level1.list[1]).toBe("[REDACTED]");
    });
  });

  describe("Sampling and Retention Path", () => {
    it("ALWAYS samples failures at 100% regardless of low sample rate", () => {
      const sampledTelemetry = new TelemetryService({
        defaultSuccessSampleRate: 0.0, // Drop all successes
      });

      const failureEvent = sampledTelemetry.record(
        "prompt-verification",
        "CREATOR",
        "FAILURE",
        Date.now(),
        "corr-fail-always",
        { error: "Stellar RPC failure" }
      );

      expect(failureEvent.sampled).toBe(true);
      expect(failureEvent.sampleRate).toBe(1.0);
      expect(sampledTelemetry.getEvents().length).toBe(1);
    });

    it("deterministically samples successes based on correlationId and sample rate", () => {
      const sampleRate = 0.5;
      const sampledTelemetry = new TelemetryService({
        defaultSuccessSampleRate: sampleRate,
      });

      let sampledCount = 0;
      const totalEvents = 100;

      for (let i = 0; i < totalEvents; i++) {
        const event = sampledTelemetry.record(
          "data-export",
          "BUYER",
          "SUCCESS",
          Date.now(),
          `corr-deterministic-test-${i}`
        );
        if (event.sampled) {
          sampledCount++;
          expect(event.sampleRate).toBe(sampleRate);
          expect(event.sampleWeight).toBe(2.0); // 1 / 0.5
        }
      }

      // 50% sampling over 100 deterministic keys should sample ~40-60 events
      expect(sampledCount).toBeGreaterThanOrEqual(30);
      expect(sampledCount).toBeLessThanOrEqual(70);
      expect(sampledTelemetry.getEvents().length).toBe(sampledCount);
    });

    it("enforces FIFO ring-buffer eviction when buffer size exceeds limit", () => {
      const tinyTelemetry = new TelemetryService({
        defaultSuccessSampleRate: 1.0,
        maxBufferSize: 3,
      });

      tinyTelemetry.record("wallet-connect", "BUYER", "SUCCESS", Date.now(), "c-1");
      tinyTelemetry.record("wallet-connect", "BUYER", "SUCCESS", Date.now(), "c-2");
      tinyTelemetry.record("wallet-connect", "BUYER", "SUCCESS", Date.now(), "c-3");
      expect(tinyTelemetry.getEvents().length).toBe(3);

      tinyTelemetry.record("wallet-connect", "BUYER", "SUCCESS", Date.now(), "c-4");
      const events = tinyTelemetry.getEvents();
      expect(events.length).toBe(3);
      expect(events[0].correlationId).toBe("c-2");
      expect(events[2].correlationId).toBe("c-4");
    });
  });
});
