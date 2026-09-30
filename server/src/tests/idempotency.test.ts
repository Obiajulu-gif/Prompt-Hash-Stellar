import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../models/IdempotencyRecord", () => ({
  default: {
    create: vi.fn(),
    findOne: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

import IdempotencyRecord from "../models/IdempotencyRecord";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  hashIdempotentRequest,
  validateIdempotencyKey,
} from "../services/idempotencyService";

const now = new Date("2026-09-29T20:00:00.000Z");
const base = {
  scope: "/api/versions/purchase",
  key: "purchase-1",
  requestHash: "hash-1",
  now,
};

function record(overrides: Record<string, unknown> = {}) {
  return {
    _id: "record-1",
    scope: base.scope,
    key: base.key,
    requestHash: base.requestHash,
    status: "succeeded",
    statusCode: 201,
    responseBody: { purchaseId: "p-1" },
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  } as any;
}

describe("idempotency service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reserves a new key and replays the same successful outcome", async () => {
    (IdempotencyRecord.create as any).mockResolvedValue(record({ status: "processing", statusCode: null, responseBody: null }));
    const first = await beginIdempotentRequest(base);
    expect(first.kind).toBe("new");

    await completeIdempotentRequest({ recordId: "record-1", statusCode: 201, responseBody: { purchaseId: "p-1" } });
    expect(IdempotencyRecord.findByIdAndUpdate).toHaveBeenCalledWith(
      "record-1",
      expect.objectContaining({ $set: expect.objectContaining({ status: "succeeded", statusCode: 201 }) }),
    );

    (IdempotencyRecord.create as any).mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: 11000 }));
    (IdempotencyRecord.findOne as any).mockResolvedValue(record());
    const retry = await beginIdempotentRequest(base);
    expect(retry.kind).toBe("replay");
    expect((retry as any).record.responseBody).toEqual({ purchaseId: "p-1" });
  });

  it("persists and replays a failure instead of executing the side effect again", async () => {
    (IdempotencyRecord.create as any).mockResolvedValue(record({ status: "processing", statusCode: null, responseBody: null }));
    const first = await beginIdempotentRequest(base);
    expect(first.kind).toBe("new");
    await completeIdempotentRequest({ recordId: "record-1", statusCode: 500, responseBody: { error: "temporary failure" } });

    (IdempotencyRecord.create as any).mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: 11000 }));
    (IdempotencyRecord.findOne as any).mockResolvedValue(
      record({ status: "failed", statusCode: 500, responseBody: { error: "temporary failure" } }),
    );
    const retry = await beginIdempotentRequest(base);
    expect(retry.kind).toBe("replay");
    expect((retry as any).record.status).toBe("failed");
    expect((retry as any).record.responseBody).toEqual({ error: "temporary failure" });
  });

  it("rejects a key collision when the payload changes", async () => {
    (IdempotencyRecord.create as any).mockRejectedValue(Object.assign(new Error("duplicate"), { code: 11000 }));
    (IdempotencyRecord.findOne as any).mockResolvedValue(record({ requestHash: "different-hash" }));
    const result = await beginIdempotentRequest(base);
    expect(result).toEqual({
      kind: "conflict",
      message: "This Idempotency-Key was already used with a different request payload.",
    });
  });

  it("reports an expired key clearly", async () => {
    (IdempotencyRecord.create as any).mockRejectedValue(Object.assign(new Error("duplicate"), { code: 11000 }));
    (IdempotencyRecord.findOne as any).mockResolvedValue(
      record({ expiresAt: new Date(now.getTime() - 1) }),
    );
    const result = await beginIdempotentRequest(base);
    expect(result.kind).toBe("expired");
  });

  it("hashes equivalent object payloads deterministically and validates keys", () => {
    expect(hashIdempotentRequest({ method: "post", scope: "/x", body: { b: 2, a: 1 } }))
      .toBe(hashIdempotentRequest({ method: "POST", scope: "/x", body: { a: 1, b: 2 } }));
    expect(validateIdempotencyKey(undefined)).toContain("required");
    expect(validateIdempotencyKey("a\nb")).toContain("line breaks");
    expect(validateIdempotencyKey("valid-key")).toBeNull();
  });
});
