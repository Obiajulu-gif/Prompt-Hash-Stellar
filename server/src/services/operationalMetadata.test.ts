import { describe, expect, it } from "vitest";
import {
  minimizeOperationalMetadata,
  OPERATIONAL_METADATA_FIELDS,
  OPERATIONAL_RETENTION_WINDOWS,
} from "./operationalMetadata";

describe("operational metadata minimization", () => {
  it("keeps only allowlisted, bounded operational identifiers and outcomes", () => {
    expect(
      minimizeOperationalMetadata({
        requestId: "req-1",
        status: "failed",
        durationMs: 42,
        attempt: 2,
        nested: { prompt: "secret" },
        promptText: "private prompt",
        walletAddress: "G...",
        resourceId: `G${"A".repeat(54)}2`,
        clientIp: "203.0.113.9",
        requestIdWithEmail: "person@example.test",
        signature: "sha256=secret",
        rawBody: "private request",
        errorCode: `E${"X".repeat(64)}`,
        invalidDurationMs: 60 * 60 * 1000 + 1,
        invalidAttempt: 1.5,
      }),
    ).toEqual({ requestId: "req-1", status: "failed", durationMs: 42, attempt: 2 });
    expect(minimizeOperationalMetadata({ resourceId: "contains\nlinebreak" })).toEqual({});
    expect(minimizeOperationalMetadata({ requestId: "person@example.test" })).toEqual({});
    expect(minimizeOperationalMetadata({ durationMs: 60 * 60 * 1000 + 1 })).toEqual({});
    expect(minimizeOperationalMetadata({ attempt: 1.5 })).toEqual({});
  });

  it("declares the complete operational metadata allowlist", () => {
    expect(OPERATIONAL_METADATA_FIELDS).toEqual([
      "requestId",
      "jobId",
      "resourceType",
      "resourceId",
      "operation",
      "status",
      "attempt",
      "durationMs",
      "errorCode",
    ]);
  });

  it("has finite windows for operational data", () => {
    expect(OPERATIONAL_RETENTION_WINDOWS).toMatchObject({
      timelineEventsDays: 90,
      promptEventsDays: 30,
      exportMetadataDays: 30,
      supportEvidenceDays: 365,
    });
  });
});
