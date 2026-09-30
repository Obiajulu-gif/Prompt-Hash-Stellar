import { describe, it, expect, vi, beforeEach } from "vitest";
import { logSensitiveFieldAccess, resetAnomalyCache, detectAnomaly } from "../../server/src/services/sensitiveFieldAudit";
import { recordAuditEvent, logger } from "../../server/src/services/auditTrail";

vi.mock("../../server/src/services/auditTrail", () => ({
  recordAuditEvent: vi.fn(),
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  }
}));

describe("Sensitive Field Audit and Anomaly Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAnomalyCache();
  });

  it("logs authorized access securely without storing field value", async () => {
    await logSensitiveFieldAccess({
      actor: "admin-1",
      resourceId: "prompt-123",
      resourceType: "prompt",
      fieldName: "plaintext",
      purpose: "review",
      isAuthorized: true,
      fieldValue: "super secret prompt text"
    });

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(recordAuditEvent).mock.calls[0][0];
    
    expect(callArg.action).toBe("audit_sensitive_field_access");
    expect(callArg.result).toBe("success");
    expect(callArg.metadata).toEqual(expect.objectContaining({
      fieldName: "plaintext",
      purpose: "review",
      anomalyDetected: false
    }));
    // Should NOT contain the sensitive value
    expect(callArg).not.toHaveProperty("fieldValue");
    expect(callArg.metadata).not.toHaveProperty("fieldValue");
    expect(JSON.stringify(callArg)).not.toContain("super secret prompt text");
  });

  it("safely captures unauthorized access attempts", async () => {
    await logSensitiveFieldAccess({
      actor: "user-hacker",
      resourceId: "prompt-123",
      resourceType: "prompt",
      fieldName: "privateKey",
      purpose: "exploit",
      isAuthorized: false,
      reason: "No permission"
    });

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(recordAuditEvent).mock.calls[0][0];
    
    expect(callArg.action).toBe("audit_sensitive_field_denied");
    expect(callArg.result).toBe("failure");
    expect(callArg.reason).toBe("No permission");
  });

  it("detects bulk access anomaly and logs it", async () => {
    // Trigger 50 rapid accesses to simulate bulk download
    for (let i = 0; i < 50; i++) {
      await logSensitiveFieldAccess({
        actor: "admin-scraper",
        resourceId: `prompt-${i}`,
        resourceType: "prompt",
        fieldName: "plaintext",
        purpose: "bulk export",
        isAuthorized: true
      });
    }

    // 50 accesses were made. The last one should trigger the anomaly detection.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("anomaly_detected: Bulk access pattern detected"),
      expect.objectContaining({
        actor: "admin-scraper",
        fieldName: "plaintext",
        count: 50,
        isAuthorized: true
      })
    );

    // Check if anomaly was recorded in the metadata of the 50th audit event
    const lastCallArg = vi.mocked(recordAuditEvent).mock.calls[49][0];
    expect(lastCallArg.metadata).toEqual(expect.objectContaining({
      anomalyDetected: true
    }));
  });
});
