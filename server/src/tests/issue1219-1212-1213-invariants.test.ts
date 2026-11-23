import { describe, expect, it } from "vitest";
import { normalizeReplayBatch } from "../services/deterministicReplay";
import { resolveEditConflict } from "../services/editConflictResolver";
import { TelemetryService } from "../../../src/observability/telemetry";

describe("issues #1219, #1212, and #1213", () => {
  it("normalizes out-of-order replay retries and rejects conflicting bytes", () => {
    const event = {
      eventId: "evt-1",
      ledger: 2,
      eventType: "prompt.updated",
      eventVersion: 1,
      payload: { promptId: "p-1", version: 2 },
    };
    const normalized = normalizeReplayBatch([
      { ...event, ledger: 3, eventId: "evt-2" },
      event,
      event,
    ]);
    expect(normalized.events.map((item) => item.eventId)).toEqual(["evt-1", "evt-2"]);
    expect(normalized.duplicates).toBe(1);

    expect(() => normalizeReplayBatch([event, { ...event, payload: { promptId: "p-2" } }])).toThrow(
      /two different payloads/,
    );
  });

  it("redacts sensitive export fields while retaining safe telemetry fields", () => {
    const telemetry = new TelemetryService();
    const value = telemetry.sanitizeValue({
      walletAddress: "GABC",
      privateKey: "SSECRET",
      correlationId: "corr-1212",
      status: "ok",
    }) as Record<string, unknown>;
    expect(value.privateKey).toBe("[REDACTED]");
    expect(value.correlationId).toBe("corr-1212");
    expect(value.status).toBe("ok");
  });

  it("keeps overlapping concurrent edits unresolved until an explicit choice", () => {
    const result = resolveEditConflict({
      base: { content: "a\nb\nc", version: 1 },
      mine: { content: "a\nmine\nc", version: 2 },
      theirs: { content: "a\ntheirs\nc", version: 2 },
    });
    expect(result.status).toBe("conflict");
    expect(result.resolved).toBe(false);
    expect(result.content).toContain("<<<<<<< mine");
  });
});
