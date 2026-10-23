import { describe, expect, it, vi } from "vitest";
import { AuditLog } from "../models/AuditLog";
import { recordAuditEvent } from "../services/auditTrail";
import { down, up } from "../db/migrations/008_minimize_audit_client_ip";

describe("audit operational metadata minimization (#915)", () => {
  it("does not define or persist clientIp on new audit records", async () => {
    expect(AuditLog.schema.path("clientIp")).toBeUndefined();

    const findOne = vi.spyOn(AuditLog, "findOne").mockReturnValue({
      sort: () => ({ lean: async () => null }),
    } as any);
    const create = vi.spyOn(AuditLog, "create").mockResolvedValue({} as any);
    try {
      await recordAuditEvent(
        { action: "admin_auth_success", result: "success", requestId: "req-915", clientIp: "203.0.113.9" },
        { throwOnError: true },
      );

      const persisted = create.mock.calls[0][0] as Record<string, unknown>;
      expect(persisted).not.toHaveProperty("clientIp");
      expect(persisted.requestId).toBe("req-915");
    } finally {
      findOne.mockRestore();
      create.mockRestore();
    }
  });

  it("scrubs legacy audit IPs with an irreversible migration", async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 3 });
    const db = { collection: vi.fn().mockReturnValue({ updateMany }) };

    await up(db as any);
    expect(db.collection).toHaveBeenCalledWith("auditlogs");
    expect(updateMany).toHaveBeenCalledWith(
      { clientIp: { $exists: true } },
      { $unset: { clientIp: "" } },
    );
    await expect(down(db as any)).resolves.toBeUndefined();
  });
});