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

describe("Atomic Search Index Refresh & Repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should mark prompt as synced on successful index refresh", async () => {
    const { refreshPromptIndex } = await import("../services/indexer");
    const Prompt = (await import("../models/Prompt")).default;

    (Prompt.findOneAndUpdate as any).mockResolvedValue({ _id: "prompt-1" });

    const result = await refreshPromptIndex("prompt-1");
    expect(result.success).toBe(true);
    expect(Prompt.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ searchIndexStatus: "synced" }),
      }),
    );
  });

  it("should record failed status and error message on index failure", async () => {
    const { refreshPromptIndex } = await import("../services/indexer");
    const Prompt = (await import("../models/Prompt")).default;

    (Prompt.findOneAndUpdate as any)
      .mockResolvedValueOnce({ _id: "prompt-1" })
      .mockRejectedValueOnce(new Error("Index connection error"));

    const result = await refreshPromptIndex("prompt-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Index connection error");
  });
});
