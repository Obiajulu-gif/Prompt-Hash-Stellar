import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  complete: vi.fn().mockResolvedValue(undefined),
  hash: vi.fn().mockReturnValue("request-hash"),
  validate: vi.fn((key?: string) => (key ? null : "missing key")),
  replayStatus: vi.fn((record: { statusCode: number }) => record.statusCode),
}));

vi.mock("../services/idempotencyService", () => ({
  beginIdempotentRequest: mocks.begin,
  completeIdempotentRequest: mocks.complete,
  hashIdempotentRequest: mocks.hash,
  replayStatus: mocks.replayStatus,
  validateIdempotencyKey: mocks.validate,
}));

import { requireIdempotency } from "../middleware/idempotency";

function makeResponse() {
  const response = new EventEmitter() as any;
  response.statusCode = 200;
  response.headers = {} as Record<string, string>;
  response.status = vi.fn((code: number) => {
    response.statusCode = code;
    return response;
  });
  response.setHeader = vi.fn((name: string, value: string) => {
    response.headers[name] = value;
    return response;
  });
  response.json = vi.fn((body: unknown) => {
    response.body = body;
    return response;
  });
  response.send = vi.fn((body: unknown) => {
    response.body = body;
    return response;
  });
  return response;
}

function makeRequest(key?: string) {
  return {
    method: "POST",
    baseUrl: "/api/versions",
    path: "/purchase",
    body: { promptId: "prompt-1", buyerWallet: "GABC" },
    get: (name: string) => (name === "Idempotency-Key" ? key : undefined),
  } as any;
}

describe("requireIdempotency middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validate.mockImplementation((key?: string) => (key ? null : "missing key"));
    mocks.hash.mockReturnValue("request-hash");
  });

  it("rejects a protected write before the controller when the key is missing", () => {
    const res = makeResponse();
    const next = vi.fn();
    requireIdempotency(makeRequest(), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({ code: "IDEMPOTENCY_KEY_REQUIRED", error: "missing key" });
    expect(next).not.toHaveBeenCalled();
  });

  it("captures the first response and replays it without calling the controller", async () => {
    const record = { _id: "record-1" } as any;
    mocks.begin.mockResolvedValueOnce({ kind: "new", record });
    const firstResponse = makeResponse();
    const firstNext = vi.fn(() => {
      firstResponse.statusCode = 201;
      firstResponse.json({ purchaseId: "purchase-1" });
      firstResponse.emit("finish");
    });
    requireIdempotency(makeRequest("purchase-key"), firstResponse, firstNext);
    await vi.waitFor(() => expect(firstNext).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledWith({
      recordId: "record-1",
      statusCode: 201,
      responseBody: { purchaseId: "purchase-1" },
    }));

    mocks.begin.mockResolvedValueOnce({
      kind: "replay",
      record: { _id: "record-1", statusCode: 201, status: "succeeded", responseBody: { purchaseId: "purchase-1" } },
    });
    const retryResponse = makeResponse();
    const retryNext = vi.fn();
    requireIdempotency(makeRequest("purchase-key"), retryResponse, retryNext);
    await vi.waitFor(() => expect(retryResponse.body).toEqual({ purchaseId: "purchase-1" }));
    expect(retryResponse.headers["Idempotent-Replayed"]).toBe("true");
    expect(retryNext).not.toHaveBeenCalled();
  });

  it("blocks a concurrent duplicate and replays the original authorization failure", async () => {
    const req = makeRequest("concurrent-key");
    const first = makeResponse();
    const duplicate = makeResponse();
    const controller = vi.fn();
    mocks.begin
      .mockResolvedValueOnce({ kind: "new", record: { _id: "record-1" } })
      .mockResolvedValueOnce({ kind: "in_progress", message: "request pending" });

    requireIdempotency(req, first, controller);
    requireIdempotency(req, duplicate, controller);
    await vi.waitFor(() => expect(duplicate.statusCode).toBe(409));
    expect(duplicate.body.code).toBe("IDEMPOTENCY_REQUEST_IN_PROGRESS");
    expect(controller).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();

    const denial = { code: "FORBIDDEN" };
    first.status(403).json(denial);
    first.emit("finish");
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.complete).toHaveBeenCalledWith({
      recordId: "record-1",
      statusCode: 403,
      responseBody: denial,
    });


    mocks.begin.mockResolvedValueOnce({
      kind: "replay",
      record: { statusCode: 403, responseBody: denial },
    });
    const retry = makeResponse();
    requireIdempotency(req, retry, controller);
    await vi.waitFor(() => expect(retry.body).toEqual(denial));
    expect(retry.statusCode).toBe(403);
    expect(controller).toHaveBeenCalledOnce();
  });

  it("returns a conflict response and does not invoke the controller", async () => {
    mocks.begin.mockResolvedValue({ kind: "conflict", message: "different payload" });
    const res = makeResponse();
    const next = vi.fn();
    requireIdempotency(makeRequest("reused-key"), res, next);
    await vi.waitFor(() => expect(res.body).toEqual({ code: "IDEMPOTENCY_KEY_CONFLICT", error: "different payload" }));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });

  it("persists a failed outcome and replays it on retry without re-running the side effect", async () => {
    // Retry after failure: the first attempt errors, so its 500 is stored and
    // a retry with the same key must receive that stored 500, not re-execute.
    mocks.begin.mockResolvedValueOnce({ kind: "new", record: { _id: "record-fail" } as any });
    const firstResponse = makeResponse();
    const firstNext = vi.fn(() => {
      firstResponse.statusCode = 500;
      firstResponse.json({ code: "DOWNSTREAM_UNAVAILABLE", error: "try later" });
      firstResponse.emit("finish");
    });
    requireIdempotency(makeRequest("retry-key"), firstResponse, firstNext);
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledWith({
      recordId: "record-fail",
      statusCode: 500,
      responseBody: { code: "DOWNSTREAM_UNAVAILABLE", error: "try later" },
    }));

    mocks.begin.mockResolvedValueOnce({
      kind: "replay",
      record: {
        _id: "record-fail",
        status: "failed",
        statusCode: 500,
        responseBody: { code: "DOWNSTREAM_UNAVAILABLE", error: "try later" },
      },
    });
    // replayStatus is read for logging and for the response, so queue the value twice.
    mocks.replayStatus.mockReturnValueOnce(500).mockReturnValueOnce(500);
    const retryResponse = makeResponse();
    const retryNext = vi.fn();
    requireIdempotency(makeRequest("retry-key"), retryResponse, retryNext);
    await vi.waitFor(() => expect(retryResponse.body).toEqual({ code: "DOWNSTREAM_UNAVAILABLE", error: "try later" }));
    expect(retryResponse.status).toHaveBeenCalledWith(500);
    expect(retryResponse.headers["Idempotent-Replayed"]).toBe("true");
    expect(retryNext).not.toHaveBeenCalled();
  });

  it("reports an expired key with a clear 409 and does not invoke the controller", async () => {
    mocks.begin.mockResolvedValueOnce({
      kind: "expired",
      message: "This Idempotency-Key has expired. Generate a new key and retry.",
    });
    const res = makeResponse();
    const next = vi.fn();
    requireIdempotency(makeRequest("old-key"), res, next);
    await vi.waitFor(() => expect(res.body).toEqual({
      code: "IDEMPOTENCY_KEY_EXPIRED",
      error: "This Idempotency-Key has expired. Generate a new key and retry.",
    }));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a concurrent duplicate while the first attempt is still processing", async () => {
    mocks.begin.mockResolvedValueOnce({
      kind: "in_progress",
      message: "An identical request with this Idempotency-Key is still in progress.",
    });
    const res = makeResponse();
    const next = vi.fn();
    requireIdempotency(makeRequest("racing-key"), res, next);
    await vi.waitFor(() => expect(res.body).toEqual({
      code: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
      error: "An identical request with this Idempotency-Key is still in progress.",
    }));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });
});
