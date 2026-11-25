import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  PrivilegedActionReceiptService,
  PrivilegedReceiptError,
} from "../services/privilegedActionReceiptService";
import { SignedReceipt } from "../models/SignedReceipt";

vi.mock("../models/SignedReceipt", () => {
  const store: any[] = [];
  return {
    SignedReceipt: {
      findOne: vi.fn(async (query: any) => {
        if (query["externalReferences.idempotencyKey"]) {
          return store.find(
            (r) =>
              r.externalReferences?.idempotencyKey ===
              query["externalReferences.idempotencyKey"]
          ) || null;
        }
        if (query.receiptId) {
          return store.find((r) => r.receiptId === query.receiptId) || null;
        }
        return null;
      }),
      create: vi.fn(async (data: any) => {
        const doc = {
          ...data,
          _id: `id_${Date.now()}_${Math.random()}`,
          toObject: () => ({ ...data }),
        };
        store.push(doc);
        return doc;
      }),
      find: vi.fn((query: any) => ({
        sort: () => ({
          limit: () => ({
            lean: async () => {
              if (query.actor) {
                return store.filter((r) => r.actor === query.actor);
              }
              if (query["externalReferences.target"]) {
                return store.filter(
                  (r) =>
                    r.externalReferences?.target ===
                    query["externalReferences.target"]
                );
              }
              return store;
            },
          }),
        }),
      })),
      _reset: () => {
        store.length = 0;
      },
    },
  };
});

vi.mock("../services/auditTrail", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(true),
  recordAccessOrOwnershipChange: vi.fn().mockResolvedValue(true),
  canonicalJson: (val: any) => JSON.stringify(val),
}));

describe("PrivilegedActionReceiptService (#1127)", () => {
  beforeEach(() => {
    (SignedReceipt as any)._reset();
    vi.clearAllMocks();
  });

  describe("Normal Path", () => {
    it("issues a cryptographically signed receipt for a successful privileged action", async () => {
      const receipt = await PrivilegedActionReceiptService.issueReceipt({
        actor: "admin-ops-1",
        action: "payouts:release",
        scope: "payouts:write",
        status: "SUCCESS",
        target: "payout-batch-901",
        targetType: "payout",
        grantId: "mag_test_123",
        reason: "Ticket INC-4402 resolution",
        payload: {
          totalAmountXlm: "5000",
          creatorCount: 12,
        },
      });

      expect(receipt).toBeDefined();
      expect(receipt.receiptId).toMatch(/^rcpt_/);
      expect(receipt.operationType).toBe("PRIVILEGED_ACTION");
      expect(receipt.actor).toBe("admin-ops-1");
      expect(receipt.status).toBe("SUCCESS");
      expect(receipt.signature).toBeDefined();
      expect(receipt.payloadDigest).toBeDefined();
      expect(receipt.externalReferences.grantId).toBe("mag_test_123");
      expect(receipt.externalReferences.target).toBe("payout-batch-901");

      const verification = PrivilegedActionReceiptService.verifyReceipt(receipt);
      expect(verification.valid).toBe(true);
      expect(verification.tamperedFields).toHaveLength(0);
    });
  });

  describe("Failure Path", () => {
    it("records a FAILED privileged action with audit details and non-repudiation", async () => {
      const receipt = await PrivilegedActionReceiptService.issueReceipt({
        actor: "maintainer-alice",
        action: "emergency:halt_market",
        scope: "market:admin",
        status: "FAILED",
        target: "contract_prompt_hash",
        targetType: "smart_contract",
        reason: "Consensus timeout during contract invocation",
        payload: {
          errorCode: "SOROBAN_RPC_TIMEOUT",
          ledgerSequence: 5412990,
        },
      });

      expect(receipt.status).toBe("FAILED");
      expect(receipt.payload).toHaveProperty("errorCode", "SOROBAN_RPC_TIMEOUT");
      const verification = PrivilegedActionReceiptService.verifyReceipt(receipt);
      expect(verification.valid).toBe(true);
    });

    it("rejects receipt creation if actor is missing", async () => {
      await expect(
        PrivilegedActionReceiptService.issueReceipt({
          actor: "",
          action: "flags:override",
          scope: "flags:write",
          status: "SUCCESS",
          payload: {},
        })
      ).rejects.toThrow(PrivilegedReceiptError);
    });
  });

  describe("Retry & Idempotency Path", () => {
    it("idempotently returns the existing receipt without duplicate writes", async () => {
      const idempotencyKey = "unique-key-retry-123";

      const receipt1 = await PrivilegedActionReceiptService.issueReceipt({
        actor: "admin-bob",
        action: "config:update_fee",
        scope: "config:write",
        status: "SUCCESS",
        idempotencyKey,
        payload: { platformFeeBps: 250 },
      });

      const receipt2 = await PrivilegedActionReceiptService.issueReceipt({
        actor: "admin-bob",
        action: "config:update_fee",
        scope: "config:write",
        status: "SUCCESS",
        idempotencyKey,
        payload: { platformFeeBps: 250 },
      });

      expect(receipt1.receiptId).toBe(receipt2.receiptId);
      expect(receipt1.nonce).toBe(receipt2.nonce);
      expect(receipt1.signature).toBe(receipt2.signature);
    });
  });

  describe("Tamper Detection", () => {
    it("detects tampered payload fields", async () => {
      const receipt = await PrivilegedActionReceiptService.issueReceipt({
        actor: "admin-ops",
        action: "payouts:release",
        scope: "payouts:write",
        status: "SUCCESS",
        payload: { amount: 100 },
      });

      // Tamper with payload
      const tampered = {
        ...receipt,
        payload: { ...receipt.payload, amount: 999999 },
      };

      const result = PrivilegedActionReceiptService.verifyReceipt(tampered);
      expect(result.valid).toBe(false);
      expect(result.tamperedFields).toContain("payload");
      expect(result.tamperedFields).toContain("signature");
    });

    it("binds admin-change scope and target metadata to the receipt signature", async () => {
      const receipt = await PrivilegedActionReceiptService.issueReceipt({
        actor: "admin-config",
        action: "flags:update",
        scope: "flags:write",
        status: "SUCCESS",
        target: "strict_settlement_checks",
        targetType: "feature_flag",
        reason: "release-1178",
        payload: { enabled: true },
      });

      const tampered = {
        ...receipt,
        externalReferences: {
          ...receipt.externalReferences,
          scope: "flags:read",
          target: "different_flag",
        },
      };

      const result = PrivilegedActionReceiptService.verifyReceipt(tampered);
      expect(result.valid).toBe(false);
      expect(result.tamperedFields).toContain("externalReferences");
      expect(result.tamperedFields).toContain("signature");
    });
  });

  describe("Query Path", () => {
    it("retrieves receipts by target", async () => {
      await PrivilegedActionReceiptService.issueReceipt({
        actor: "admin-1",
        action: "review:merge",
        scope: "record_merge:write",
        status: "SUCCESS",
        target: "prompt-12345",
        targetType: "prompt",
        payload: {},
      });

      const results = await PrivilegedActionReceiptService.getReceiptsByTarget("prompt-12345");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].externalReferences.target).toBe("prompt-12345");
    });
  });
});

