import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ChangeHistoryService,
  computeChangeHistoryHash,
  computeChangedFields,
  GENESIS_HASH,
} from "../services/changeHistory";
import { ChangeHistoryEntry } from "../models/ChangeHistoryEntry";

describe("ChangeHistoryService (Issue #830)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("computeChangeHistoryHash", () => {
    it("produces deterministic canonical hashes regardless of key ordering", () => {
      const now = new Date("2026-09-27T12:00:00.000Z");

      const hash1 = computeChangeHistoryHash({
        recordType: "prompt",
        recordId: "prompt-101",
        sequence: 1,
        operation: "create",
        actor: "GCREATOR_ALICE",
        reason: "Initial prompt publication",
        beforeState: null,
        afterState: { title: "AI Prompt", price: 50, currency: "XLM" },
        previousHash: GENESIS_HASH,
        createdAt: now,
      });

      const hash2 = computeChangeHistoryHash({
        recordType: "prompt",
        recordId: "prompt-101",
        sequence: 1,
        operation: "create",
        actor: "GCREATOR_ALICE",
        reason: "Initial prompt publication",
        beforeState: null,
        afterState: { currency: "XLM", title: "AI Prompt", price: 50 },
        previousHash: GENESIS_HASH,
        createdAt: now,
      });

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("changes hash if any critical field is modified", () => {
      const base = {
        recordType: "prompt" as const,
        recordId: "prompt-101",
        sequence: 1,
        operation: "create" as const,
        actor: "GCREATOR_ALICE",
        reason: "Initial prompt publication",
        beforeState: null,
        afterState: { title: "AI Prompt", price: 50 },
        previousHash: GENESIS_HASH,
        createdAt: new Date("2026-09-27T12:00:00.000Z"),
      };

      const baseHash = computeChangeHistoryHash(base);

      // Changed actor
      expect(
        computeChangeHistoryHash({ ...base, actor: "GCREATOR_BOB" }),
      ).not.toBe(baseHash);

      // Changed reason
      expect(
        computeChangeHistoryHash({ ...base, reason: "Updated reason" }),
      ).not.toBe(baseHash);

      // Changed price in afterState
      expect(
        computeChangeHistoryHash({
          ...base,
          afterState: { title: "AI Prompt", price: 60 },
        }),
      ).not.toBe(baseHash);

      // Changed sequence
      expect(computeChangeHistoryHash({ ...base, sequence: 2 })).not.toBe(
        baseHash,
      );

      // Changed previousHash
      expect(
        computeChangeHistoryHash({
          ...base,
          previousHash: "1".repeat(64),
        }),
      ).not.toBe(baseHash);
    });
  });

  describe("computeChangedFields", () => {
    it("detects added fields on initial creation", () => {
      const changed = computeChangedFields(null, {
        owner: "GALICE",
        price: 100,
        status: "PUBLISHED",
      });
      expect(changed).toEqual(["owner", "price", "status"]);
    });

    it("detects modified and deleted fields on update", () => {
      const before = {
        owner: "GALICE",
        price: 100,
        status: "PUBLISHED",
        active: true,
      };
      const after = {
        owner: "GBOB",
        price: 120,
        status: "PUBLISHED",
      };

      const changed = computeChangedFields(before, after);
      expect(changed).toEqual(["active", "owner", "price"]);
    });
  });

  describe("recordMutation", () => {
    it("rejects unauthorized or missing actor context", async () => {
      await expect(
        ChangeHistoryService.recordMutation({
          recordType: "prompt",
          recordId: "prompt-1",
          operation: "update",
          beforeState: { price: 10 },
          afterState: { price: 20 },
          actor: "   ",
          reason: "Price hike",
        }),
      ).rejects.toThrow("actor is required");
    });

    it("rejects missing reason context", async () => {
      await expect(
        ChangeHistoryService.recordMutation({
          recordType: "prompt",
          recordId: "prompt-1",
          operation: "update",
          beforeState: { price: 10 },
          afterState: { price: 20 },
          actor: "GADMIN1",
          reason: "",
        }),
      ).rejects.toThrow("reason is required");
    });

    it("rejects invalid record types or operations", async () => {
      await expect(
        ChangeHistoryService.recordMutation({
          recordType: "invalid_type" as any,
          recordId: "prompt-1",
          operation: "update",
          beforeState: null,
          afterState: {},
          actor: "GADMIN1",
          reason: "Test",
        }),
      ).rejects.toThrow("Invalid record type");

      await expect(
        ChangeHistoryService.recordMutation({
          recordType: "prompt",
          recordId: "prompt-1",
          operation: "invalid_op" as any,
          beforeState: null,
          afterState: {},
          actor: "GADMIN1",
          reason: "Test",
        }),
      ).rejects.toThrow("Invalid operation");
    });

    it("creates initial sequence 1 linked to GENESIS_HASH", async () => {
      vi.spyOn(ChangeHistoryEntry, "findOne").mockReturnValue({
        sort: () => ({
          lean: async () => null,
        }),
      } as any);

      let createdDoc: any = null;
      vi.spyOn(ChangeHistoryEntry, "create").mockImplementation(async (doc: any) => {
        createdDoc = doc;
        return doc;
      });

      const entry = await ChangeHistoryService.recordMutation({
        recordType: "ownership_transfer",
        recordId: "transfer-99",
        operation: "create",
        beforeState: null,
        afterState: {
          promptId: "prompt-1",
          fromWallet: "GALICE",
          toWallet: "GBOB",
          status: "pending",
        },
        actor: "GALICE",
        reason: "Initiated ownership transfer",
      });

      expect(entry.sequence).toBe(1);
      expect(entry.previousHash).toBe(GENESIS_HASH);
      expect(entry.recordHash).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.changedFields).toEqual([
        "fromWallet",
        "promptId",
        "status",
        "toWallet",
      ]);
      expect(createdDoc.actor).toBe("GALICE");
    });

    it("increments sequence and chains to previous record hash", async () => {
      const prevHash = "e".repeat(64);
      vi.spyOn(ChangeHistoryEntry, "findOne").mockReturnValue({
        sort: () => ({
          lean: async () => ({
            sequence: 1,
            recordHash: prevHash,
          }),
        }),
      } as any);

      let createdDoc: any = null;
      vi.spyOn(ChangeHistoryEntry, "create").mockImplementation(async (doc: any) => {
        createdDoc = doc;
        return doc;
      });

      const entry = await ChangeHistoryService.recordMutation({
        recordType: "entitlement",
        recordId: "ent-42",
        operation: "revoke",
        beforeState: { userAddress: "GBUYER", promptId: "42", status: "active" },
        afterState: {
          userAddress: "GBUYER",
          promptId: "42",
          status: "revoked",
          revocationReason: "Chargeback dispute settled",
        },
        actor: "GADMIN_OFFICER",
        reason: "Chargeback dispute resolved",
      });

      expect(entry.sequence).toBe(2);
      expect(entry.previousHash).toBe(prevHash);
      expect(entry.recordHash).not.toBe(prevHash);
      expect(entry.changedFields).toEqual(["revocationReason", "status"]);
    });
  });

  describe("verifyChain", () => {
    function generateValidChain() {
      const t1 = new Date("2026-09-27T10:00:00.000Z");
      const t2 = new Date("2026-09-27T11:00:00.000Z");
      const t3 = new Date("2026-09-27T12:00:00.000Z");

      const entry1 = {
        sequence: 1,
        recordType: "prompt" as const,
        recordId: "prompt-1",
        operation: "create" as const,
        actor: "GALICE",
        reason: "Initial create",
        beforeState: null,
        afterState: { owner: "GALICE", price: 10, status: "DRAFT" },
        previousHash: GENESIS_HASH,
        recordHash: "",
        createdAt: t1,
      };
      entry1.recordHash = computeChangeHistoryHash(entry1);

      const entry2 = {
        sequence: 2,
        recordType: "prompt" as const,
        recordId: "prompt-1",
        operation: "update" as const,
        actor: "GALICE",
        reason: "Publish listing",
        beforeState: { owner: "GALICE", price: 10, status: "DRAFT" },
        afterState: { owner: "GALICE", price: 10, status: "PUBLISHED" },
        previousHash: entry1.recordHash,
        recordHash: "",
        createdAt: t2,
      };
      entry2.recordHash = computeChangeHistoryHash(entry2);

      const entry3 = {
        sequence: 3,
        recordType: "prompt" as const,
        recordId: "prompt-1",
        operation: "transfer" as const,
        actor: "GBOB",
        reason: "Transfer accepted",
        beforeState: { owner: "GALICE", price: 10, status: "PUBLISHED" },
        afterState: { owner: "GBOB", price: 10, status: "PUBLISHED" },
        previousHash: entry2.recordHash,
        recordHash: "",
        createdAt: t3,
      };
      entry3.recordHash = computeChangeHistoryHash(entry3);

      return [entry1, entry2, entry3];
    }

    it("verifies a valid unbroken chain successfully", () => {
      const chain = generateValidChain();
      const result = ChangeHistoryService.verifyChain(chain);
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(3);
      expect(result.errors).toEqual([]);
    });

    it("detects altered afterState snapshot (content tampering)", () => {
      const chain = generateValidChain();
      // Maliciously tamper with entry2 price without changing hash
      chain[1].afterState.price = 999;

      const result = ChangeHistoryService.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Tampered record at sequence 2"))).toBe(true);
    });

    it("detects altered actor in history entry", () => {
      const chain = generateValidChain();
      chain[2].actor = "GEVIL_ATTACKER";

      const result = ChangeHistoryService.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Tampered record at sequence 3"))).toBe(true);
    });

    it("detects missing history entry in sequence (sequence gap)", () => {
      const chain = generateValidChain();
      // Drop entry 2 (chain is now 1, 3)
      const missingMiddle = [chain[0], chain[2]];

      const result = ChangeHistoryService.verifyChain(missingMiddle);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Sequence mismatch"))).toBe(true);
      expect(result.errors.some((e) => e.includes("Hash chain break"))).toBe(true);
    });

    it("detects out-of-order history entries (timestamp regression)", () => {
      const chain = generateValidChain();
      // Swap order of entry 2 and 3
      const reordered = [chain[0], chain[2], chain[1]];

      const result = ChangeHistoryService.verifyChain(reordered);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Sequence mismatch") || e.includes("Timestamp regression"))).toBe(true);
    });

    it("detects broken hash chaining", () => {
      const chain = generateValidChain();
      chain[2].previousHash = "f".repeat(64); // Break link

      const result = ChangeHistoryService.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Hash chain break at sequence 3"))).toBe(true);
    });

    it("detects state continuity violation between consecutive entries", () => {
      const chain = generateValidChain();
      // Modify beforeState of entry 3 to not match afterState of entry 2, and update its hash
      chain[2].beforeState = { owner: "GUNKNOWN", price: 10, status: "PUBLISHED" };
      chain[2].recordHash = computeChangeHistoryHash(chain[2]);

      const result = ChangeHistoryService.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("State continuity violation at sequence 3")),
      ).toBe(true);
    });
  });

  describe("verifyRecordHistory and verifyAllHistory", () => {
    it("queries and verifies record history via ChangeHistoryEntry.find", async () => {
      const t1 = new Date("2026-09-27T10:00:00.000Z");
      const entry1 = {
        sequence: 1,
        recordType: "api_key" as const,
        recordId: "key-123",
        operation: "create" as const,
        actor: "GUSER_CAROL",
        reason: "Generated API Key",
        beforeState: null,
        afterState: { scopes: ["read"], status: "active" },
        previousHash: GENESIS_HASH,
        recordHash: "",
        createdAt: t1,
      };
      entry1.recordHash = computeChangeHistoryHash(entry1);

      vi.spyOn(ChangeHistoryEntry, "find").mockReturnValue({
        sort: () => ({
          lean: async () => [entry1],
        }),
      } as any);

      const res = await ChangeHistoryService.verifyRecordHistory("api_key", "key-123");
      expect(res.valid).toBe(true);
      expect(res.totalEntries).toBe(1);
    });

    it("verifies across all grouped records and reports composite failures", async () => {
      const t1 = new Date("2026-09-27T10:00:00.000Z");
      const validEntry = {
        sequence: 1,
        recordType: "ledger_entry" as const,
        recordId: "led-1",
        operation: "create" as const,
        actor: "SYSTEM",
        reason: "Payout registered",
        beforeState: null,
        afterState: { amount: 50, currency: "XLM", reconciled: false },
        previousHash: GENESIS_HASH,
        recordHash: "",
        createdAt: t1,
      };
      validEntry.recordHash = computeChangeHistoryHash(validEntry);

      const tamperedEntry = {
        sequence: 1,
        recordType: "prompt" as const,
        recordId: "prompt-99",
        operation: "create" as const,
        actor: "ATTACKER",
        reason: "Fake",
        beforeState: null,
        afterState: { owner: "ATTACKER" },
        previousHash: GENESIS_HASH,
        recordHash: "bad_hash_000000000000000000000000000000000000000000000000000000000",
        createdAt: t1,
      };

      vi.spyOn(ChangeHistoryEntry, "find").mockReturnValue({
        sort: () => ({
          lean: async () => [validEntry, tamperedEntry],
        }),
      } as any);

      const res = await ChangeHistoryService.verifyAllHistory();
      expect(res.valid).toBe(false);
      expect(res.totalEntries).toBe(2);
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors[0]).toContain("[prompt:prompt-99]");
    });
  });
});
