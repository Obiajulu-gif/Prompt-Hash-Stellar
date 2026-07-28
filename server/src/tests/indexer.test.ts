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
