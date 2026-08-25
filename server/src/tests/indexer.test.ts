import { describe, it, expect, vi, beforeEach } from "vitest";
import ProcessedEvent from "../models/ProcessedEvent";
import { processEvent } from "../services/indexer";
import { scValToNative } from "@stellar/stellar-sdk";

// Mock external dependencies
vi.mock("../models/ProcessedEvent", () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock("../models/Prompt", () => ({
  default: {
    findOneAndUpdate: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock("../models/User", () => ({
  default: {
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../models/Purchase", () => ({
  default: {
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock("../services/webhookOutbox", () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/cacheService", () => ({
  cacheDel: vi.fn(),
  cacheDelPattern: vi.fn(),
  CACHE_KEYS: {
    promptDetail: (id: string) => `prompt:${id}`,
  },
}));

vi.mock("../../../packages/sdk/src/events/decode.js", () => ({
  decodeEvent: vi.fn(() => ({ recognized: false })),
}));

describe("Indexer Event Deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should process a new event successfully", async () => {
    (ProcessedEvent.create as any).mockResolvedValueOnce({ _id: "new" });

    const mockEvent = {
      id: "0000000000000000-0",
      ledger: 100,
      txHash: "0xhash",
      contractId: "0xcontract",
      topic: [{ type: "symbol", value: "test" }],
      value: { type: "i32", value: 1 },
      inSuccessfulContractInvocation: true,
    } as any;

    await expect(processEvent(mockEvent)).resolves.not.toThrow();
    expect(ProcessedEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "0000000000000000-0" })
    );
  });

  it("should skip processing if the event is a duplicate", async () => {
    const duplicateError = new Error("Duplicate");
    (duplicateError as any).code = 11000;
    (ProcessedEvent.create as any).mockRejectedValueOnce(duplicateError);

    const mockEvent = {
      id: "0000000000000000-0",
      ledger: 100,
      txHash: "0xhash",
      contractId: "0xcontract",
      topic: [{ type: "symbol", value: "test" }],
      value: { type: "i32", value: 1 },
      inSuccessfulContractInvocation: true,
    } as any;

    await expect(processEvent(mockEvent)).resolves.not.toThrow();
    expect(ProcessedEvent.create).toHaveBeenCalled();
  });

  it("should throw if create fails with a non-duplicate error", async () => {
    const unknownError = new Error("DB Error");
    (ProcessedEvent.create as any).mockRejectedValueOnce(unknownError);

    const mockEvent = {
      id: "0000000000000000-0",
      ledger: 100,
      txHash: "0xhash",
      contractId: "0xcontract",
      topic: [{ type: "symbol", value: "test" }],
      value: { type: "i32", value: 1 },
      inSuccessfulContractInvocation: true,
    } as any;

    await expect(processEvent(mockEvent)).rejects.toThrow("DB Error");
  });
});

describe("Indexer Dispute/Settlement Event Lifecycle", () => {
  const ADDR_BUYER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBEUY";
  const PROMPT_ID = "42";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should update Purchase status to disputed when DisputeOpened event is processed", async () => {
    const { decodeEvent } = await import("../../../packages/sdk/src/events/decode.js");
    (decodeEvent as any).mockReturnValueOnce({
      recognized: true,
      type: "DisputeOpened",
      version: 1,
      data: { prompt_id: 42n, buyer: ADDR_BUYER },
    });

    (ProcessedEvent.create as any).mockResolvedValueOnce({ _id: "event1" });

    const Purchase = (await import("../models/Purchase")).default;
    (Purchase.findOneAndUpdate as any).mockResolvedValueOnce({
      status: "disputed",
    });

    const mockEvent = {
      id: "event1",
      ledger: 100,
      txHash: "0xtxhash",
      contractId: "0xcontract",
      topic: ["DisputeOpened"],
      value: { prompt_id: 42n, buyer: ADDR_BUYER },
      inSuccessfulContractInvocation: true,
    } as any;

    await processEvent(mockEvent);

    expect(Purchase.findOneAndUpdate).toHaveBeenCalledWith(
      { promptId: PROMPT_ID, buyerWallet: ADDR_BUYER.toLowerCase() },
      { $set: { status: "disputed" } },
    );
  });

  it("should update Purchase status and resolution when DisputeResolved (refunded) event is processed", async () => {
    const { decodeEvent } = await import("../../../packages/sdk/src/events/decode.js");
    (decodeEvent as any).mockReturnValueOnce({
      recognized: true,
      type: "DisputeResolved",
      version: 1,
      data: { prompt_id: 42n, buyer: ADDR_BUYER, refunded: true },
    });

    (ProcessedEvent.create as any).mockResolvedValueOnce({ _id: "event2" });

    const Purchase = (await import("../models/Purchase")).default;
    (Purchase.findOneAndUpdate as any).mockResolvedValueOnce({
      status: "resolved",
      disputeResolution: "refunded",
    });

    const mockEvent = {
      id: "event2",
      ledger: 101,
      txHash: "0xtxhash2",
      contractId: "0xcontract",
      topic: ["DisputeResolved"],
      value: { prompt_id: 42n, buyer: ADDR_BUYER, refunded: true },
      inSuccessfulContractInvocation: true,
    } as any;

    await processEvent(mockEvent);

    expect(Purchase.findOneAndUpdate).toHaveBeenCalledWith(
      { promptId: PROMPT_ID, buyerWallet: ADDR_BUYER.toLowerCase() },
      {
        $set: {
          status: "resolved",
          disputeResolution: "refunded",
        },
      },
    );
  });

  it("should update Purchase status and resolution when DisputeResolved (rejected) event is processed", async () => {
    const { decodeEvent } = await import("../../../packages/sdk/src/events/decode.js");
    (decodeEvent as any).mockReturnValueOnce({
      recognized: true,
      type: "DisputeResolved",
      version: 1,
      data: { prompt_id: 42n, buyer: ADDR_BUYER, refunded: false },
    });

    (ProcessedEvent.create as any).mockResolvedValueOnce({ _id: "event3" });

    const Purchase = (await import("../models/Purchase")).default;
    (Purchase.findOneAndUpdate as any).mockResolvedValueOnce({
      status: "resolved",
      disputeResolution: "rejected",
    });

    const mockEvent = {
      id: "event3",
      ledger: 102,
      txHash: "0xtxhash3",
      contractId: "0xcontract",
      topic: ["DisputeResolved"],
      value: { prompt_id: 42n, buyer: ADDR_BUYER, refunded: false },
      inSuccessfulContractInvocation: true,
    } as any;

    await processEvent(mockEvent);

    expect(Purchase.findOneAndUpdate).toHaveBeenCalledWith(
      { promptId: PROMPT_ID, buyerWallet: ADDR_BUYER.toLowerCase() },
      {
        $set: {
          status: "resolved",
          disputeResolution: "rejected",
        },
      },
    );
  });

  it("should replay full purchase → dispute → resolve sequence idempotently", async () => {
    const { decodeEvent } = await import("../../../packages/sdk/src/events/decode.js");

    (ProcessedEvent.create as any).mockResolvedValue({ _id: "event" });

    const Purchase = (await import("../models/Purchase")).default;
    (Purchase.findOneAndUpdate as any).mockResolvedValue({ status: "resolved" });

    const { enqueue: enqueueWebhook } = await import("../services/webhookOutbox");

    // Replay: DisputeOpened event twice (idempotent)
    (decodeEvent as any).mockReturnValueOnce({
      recognized: true,
      type: "DisputeOpened",
      version: 1,
      data: { prompt_id: 42n, buyer: ADDR_BUYER },
    });

    const disputeOpenedEvent = {
      id: "dispute-opened-1",
      ledger: 100,
      txHash: "0xhash",
      contractId: "0xcontract",
      topic: ["DisputeOpened"],
      value: { prompt_id: 42n, buyer: ADDR_BUYER },
      inSuccessfulContractInvocation: true,
    } as any;

    await processEvent(disputeOpenedEvent);

    // Same event replayed (should be caught as duplicate by ProcessedEvent)
    const duplicateError = new Error("Duplicate");
    (duplicateError as any).code = 11000;
    (ProcessedEvent.create as any).mockRejectedValueOnce(duplicateError);

    await processEvent(disputeOpenedEvent);

    // Should only process once
    expect(Purchase.findOneAndUpdate).toHaveBeenCalledTimes(1);

    // Replay: DisputeResolved event
    (decodeEvent as any).mockReturnValueOnce({
      recognized: true,
      type: "DisputeResolved",
      version: 1,
      data: { prompt_id: 42n, buyer: ADDR_BUYER, refunded: true },
    });

    (ProcessedEvent.create as any).mockResolvedValueOnce({ _id: "dispute-resolved-1" });

    const disputeResolvedEvent = {
      id: "dispute-resolved-1",
      ledger: 101,
      txHash: "0xhash2",
      contractId: "0xcontract",
      topic: ["DisputeResolved"],
      value: { prompt_id: 42n, buyer: ADDR_BUYER, refunded: true },
      inSuccessfulContractInvocation: true,
    } as any;

    await processEvent(disputeResolvedEvent);

    // Verify final state
    expect(Purchase.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(Purchase.findOneAndUpdate).toHaveBeenLastCalledWith(
      { promptId: PROMPT_ID, buyerWallet: ADDR_BUYER.toLowerCase() },
      {
        $set: {
          status: "resolved",
          disputeResolution: "refunded",
        },
      },
    );
  });

  it("should enqueue webhook notifications for dispute events", async () => {
    const { decodeEvent } = await import("../../../packages/sdk/src/events/decode.js");
    const { enqueue: enqueueWebhook } = await import("../services/webhookOutbox");

    (decodeEvent as any).mockReturnValueOnce({
      recognized: true,
      type: "DisputeOpened",
      version: 1,
      data: { prompt_id: 42n, buyer: ADDR_BUYER },
    });

    (ProcessedEvent.create as any).mockResolvedValueOnce({ _id: "event1" });

    const Purchase = (await import("../models/Purchase")).default;
    (Purchase.findOneAndUpdate as any).mockResolvedValueOnce({ status: "disputed" });

    const mockEvent = {
      id: "event1",
      ledger: 100,
      txHash: "0xtxhash",
      contractId: "0xcontract",
      topic: ["DisputeOpened"],
      value: { prompt_id: 42n, buyer: ADDR_BUYER },
      inSuccessfulContractInvocation: true,
    } as any;

    await processEvent(mockEvent);

    expect(enqueueWebhook).toHaveBeenCalledWith(
      ADDR_BUYER.toLowerCase(),
      "DisputeOpened",
      expect.objectContaining({
        promptId: PROMPT_ID,
        buyer: ADDR_BUYER,
      }),
      "event1",
    );
  });
});
