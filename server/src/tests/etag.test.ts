import { describe, it, expect, vi } from "vitest";
import { Request, Response } from "express";
import { sendConditionalJson, markPrivate } from "../middleware/etag";

function makeRes(): Partial<Response> & {
  setHeader: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  const res: any = {
    setHeader: vi.fn(),
    end: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  res.status = vi.fn().mockReturnValue(res);
  return res;
}

describe("sendConditionalJson", () => {
  it("sets a strong ETag and a public Cache-Control header, returning 200 with the payload", () => {
    const req = { headers: {} } as Request;
    const res = makeRes();

    sendConditionalJson(req, res as unknown as Response, { data: [{ id: 1 }] });

    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      expect.stringContaining("public"),
    );
    expect(res.setHeader).toHaveBeenCalledWith("ETag", expect.stringMatching(/^".+"$/));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 1 }] });
  });

  it("produces the same ETag for identical payloads (unchanged responses return 304 correctly)", () => {
    const req1 = { headers: {} } as Request;
    const res1 = makeRes();
    sendConditionalJson(req1, res1 as unknown as Response, { data: [{ id: 1 }] });
    const firstEtag = res1.setHeader.mock.calls.find((c: any[]) => c[0] === "ETag")?.[1];

    // Second request presents the ETag it received via If-None-Match.
    const req2 = { headers: { "if-none-match": firstEtag } } as unknown as Request;
    const res2 = makeRes();
    sendConditionalJson(req2, res2 as unknown as Response, { data: [{ id: 1 }] });

    expect(res2.status).toHaveBeenCalledWith(304);
    expect(res2.end).toHaveBeenCalled();
    expect(res2.json).not.toHaveBeenCalled();
  });

  it("invalidates the previous tag when the underlying listing data changes", () => {
    const req = { headers: {} } as Request;

    const resBefore = makeRes();
    sendConditionalJson(req, resBefore as unknown as Response, { data: [{ id: 1, price: 5 }] });
    const etagBefore = resBefore.setHeader.mock.calls.find((c: any[]) => c[0] === "ETag")?.[1];

    // Same request, but the listing was updated (e.g. by an indexed price change).
    const reqWithStaleTag = { headers: { "if-none-match": etagBefore } } as unknown as Request;
    const resAfter = makeRes();
    sendConditionalJson(reqWithStaleTag, resAfter as unknown as Response, {
      data: [{ id: 1, price: 6 }],
    });

    expect(resAfter.status).toHaveBeenCalledWith(200);
    expect(resAfter.json).toHaveBeenCalledWith({ data: [{ id: 1, price: 6 }] });
    const etagAfter = resAfter.setHeader.mock.calls.find((c: any[]) => c[0] === "ETag")?.[1];
    expect(etagAfter).not.toBe(etagBefore);
  });

  it("honors a wildcard If-None-Match", () => {
    const req = { headers: { "if-none-match": "*" } } as unknown as Request;
    const res = makeRes();

    sendConditionalJson(req, res as unknown as Response, { data: [] });

    expect(res.status).toHaveBeenCalledWith(304);
  });
});

describe("markPrivate", () => {
  it("sets a private, no-store Cache-Control header for wallet-scoped responses", () => {
    const res = { setHeader: vi.fn() } as unknown as Response;
    markPrivate(res);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });
});
