import { describe, expect, it } from "vitest";
import {
  redactSensitive,
  serializeLogEntry,
} from "../middleware/correlation";
import {
  redactSensitiveData,
  formatStructuredLog,
} from "../middleware/errorHandler";
import {
  buildCsv,
  redactSensitiveFields,
  escapeCsvField,
} from "../services/sensitiveContent";

describe("privacy redaction for logs and exports", () => {
  it("removes secrets, PII, prompt bodies, and authorization values from serialized logs", () => {
    const entry = {
      event: "request.error",
      correlationId: "req-redaction",
      authorization: "Bearer secret-token-value",
      prompt: "Do not expose this prompt",
      email: "person@example.test",
      nested: { privateKey: "S012345678", safe: "diagnostic code" },
    };
    const serialized = serializeLogEntry(entry);
    expect(serialized).not.toContain("secret-token-value");
    expect(serialized).not.toContain("Do not expose this prompt");
    expect(serialized).not.toContain("person@example.test");
    expect(serialized).not.toContain("S012345678");
    expect(serialized).toContain("req-redaction");
    expect(serialized).toContain("diagnostic code");
  });

  it("keeps two log redactors consistent for nested failure payloads", () => {
    const payload = {
      error: "validation failed",
      password: "hunter2",
      signedPayload: "eyJabc",
      reason: "invalid owner",
    };
    expect(redactSensitive(payload)).toMatchObject({
      password: "[REDACTED]",
      signedPayload: "[REDACTED]",
      reason: "invalid owner",
    });
    expect(redactSensitiveData(payload)).toMatchObject({
      password: "[REDACTED]",
      signedPayload: "[REDACTED]",
      reason: "invalid owner",
    });
  });

  it("redacts export data without leaking wallet, prompt, or retry metadata", () => {
    const exportPayload = {
      event: "owner_export",
      walletAddress: "GABC123",
      ownerWalletHash: "hashed-wallet",
      encryptedPrompt: "ciphertext",
      lifecycleHistory: [
        { reason: "authorized retry", nested: { refreshToken: "rt-secret" } },
      ],
    };
    const redacted = redactSensitiveFields(exportPayload);
    const text = JSON.stringify(redacted);
    expect(text).not.toContain("ciphertext");
    expect(text).not.toContain("rt-secret");
    expect(text).not.toContain("GABC123");
    expect(text).toContain("hashed-wallet");
  });

  it("neutralizes CSV formula injection and strips sensitive cells", () => {
    expect(escapeCsvField("=HYPERLINK(\"evil\")")).toBe("\"'=HYPERLINK(\"\"evil\"\")\"");
    expect(buildCsv(["title", "email"], [["safe", "person@example.test"], ["=SUM(1,2)", "x"]]))
      .not.toContain("=SUM");
  });

  it("bounds hostile retry and authorization payloads safely", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 12; i += 1) {
      cursor.child = {};
      cursor = cursor.child as Record<string, unknown>;
    }
    const redacted = redactSensitiveFields(
      { authorization: "Bearer secret", deep },
      { maxDepth: 2 },
    );
    expect(formatStructuredLog({
      timestamp: "2026-11-23T00:00:00Z",
      severity: "warn",
      event: "authorization.denied",
      message: "Bearer secret",
      fields: { authorization: "Bearer secret", retryCount: 3 },
    })).not.toContain("Bearer secret");
    expect(JSON.stringify(redacted)).not.toContain("Bearer secret");
  });
});
