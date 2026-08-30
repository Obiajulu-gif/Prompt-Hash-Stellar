import { describe, it, expect, vi, beforeEach } from "vitest";
import { processEvent, replayQuarantinedEvents, quarantineEvent } from "../services/indexer";
import QuarantinedEvent from "../models/QuarantinedEvent";
import ProcessedEvent from "../models/ProcessedEvent";
import { IndexerState } from "../models/IndexerState";
import { decodeEvent } from "../../../packages/sdk/src/events/decode.js";

vi.mock("../models/ProcessedEvent", () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock("../models/QuarantinedEvent", () => ({
  default: {
    findOneAndUpdate: vi.fn().mockResolvedValue({}),
    find: vi.fn(),
    countDocuments: vi.fn().mockResolvedValue(0),
  },
  QuarantinedEvent: {
    findOneAndUpdate: vi.fn().mockResolvedValue({}),
    find: vi.fn(),
    countDocuments: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("../models/IndexerState", () => ({
  IndexerState: {
    findOneAndUpdate: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../models/Prompt", () => ({
  default: {
    findOneAndUpdate: vi.fn().mockResolvedValue({}),
    findOne: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../models/User", () => ({
  default: {
    findOne: vi.fn().mockResolvedValue({ _id: "user1" }),
    create: vi.fn().mockResolvedValue({ _id: "user1" }),
  },
}));

vi.mock("../models/Purchase", () => ({
  default: {
    findOneAndUpdate: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../models/PriceChange", () => ({
  default: {
    findOneAndUpdate: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../services/webhookOutbox", () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/cacheService", () => ({
  cacheDel: vi.fn(),
  cacheDelPattern: vi.fn(),
  invalidatePromptCaches: vi.fn().mockResolvedValue(undefined),
  cacheGetJson: vi.fn().mockResolvedValue(null),
  cacheSetJson: vi.fn().mockResolvedValue(undefined),
  CACHE_KEYS: {
    promptDetail: (id: string) => `prompt:${id}`,
    promptMetadata: (id: string) => `prompt:metadata:${id}`,
  },
  METADATA_TTL_SECONDS: 300,
}));

vi.mock("../../../packages/sdk/src/events/decode.js", () => ({
  decodeEvent: vi.fn(),
}));

describe("Indexer Quarantine and Replay Service (#654)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should quarantine unrecognized event without throwing", async () => {
    (ProcessedEvent.create as any).mockResolvedValueOnce({ _id: "proc1" });
    (decodeEvent as any).mockReturnValueOnce({ recognized: false, reason: "unknown_type" });

    const mockEvent = {
      id: "0000000000000100-1",
      ledger: 100,
      txHash: "0xtxhash",
      contractId: "0xcontract",
      topic: [{ type: "symbol", value: "UnknownFutureEvent" }],
      value: { type: "i32", value: 123 },
    } as any;

    await expect(processEvent(mockEvent)).resolves.not.toThrow();

    expect(QuarantinedEvent.findOneAndUpdate).toHaveBeenCalledWith(
      { eventId: "0000000000000100-1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          eventId: "0000000000000100-1",
          ledger: 100,
          reason: "unknown_type",
          status: "quarantined",
        }),
      }),
      expect.any(Object),
    );

    expect(IndexerState.findOneAndUpdate).toHaveBeenCalledWith(
      { key: "prompt_hash_contract" },
      expect.objectContaining({
        $inc: { quarantinedCount: 1 },
      }),
    );
  });

  it("should quarantine malformed XDR events immediately", async () => {
    const malformedEvent = {
      id: "0000000000000100-2",
      ledger: 100,
      txHash: "0xtxhash",
      contractId: "0xcontract",
      topic: [null as any], // causes scValToNative failure
      value: null,
    } as any;

    await expect(processEvent(malformedEvent)).resolves.not.toThrow();
    expect(QuarantinedEvent.findOneAndUpdate).toHaveBeenCalledWith(
      { eventId: "0000000000000100-2" },
      expect.objectContaining({
        $set: expect.objectContaining({
          reason: "malformed_xdr",
        }),
      }),
      expect.any(Object),
    );
  });

  it("should replay quarantined events idempotently when decoder recognizes them", async () => {
    const mockQuarantinedItem = {
      eventId: "0000000000000100-3",
      ledger: 100,
      topic: "PromptCreated",
      rawValue: { prompt_id: 1, creator: "GCREATOR", price_stroops: 10000000 },
      txHash: "0xtx",
      save: vi.fn().mockResolvedValue(undefined),
    };

    const sortMock = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([mockQuarantinedItem]),
    });
    (QuarantinedEvent.find as any).mockReturnValue({ sort: sortMock });
    (decodeEvent as any).mockReturnValueOnce({
      recognized: true,
      type: "PromptCreated",
      version: 1,
      data: { prompt_id: 1, creator: "GCREATOR", price_stroops: 10000000 },
    });

    const result = await replayQuarantinedEvents({ maxEvents: 10 });
    expect(result.replayed).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockQuarantinedItem.save).toHaveBeenCalled();
  });
});
