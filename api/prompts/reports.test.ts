import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectDb: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("../../server/src/db/connectDb.js", () => ({
  default: mocks.connectDb,
}));
vi.mock("../../server/src/models/Report", () => ({
  default: {
    create: mocks.create,
    find: mocks.find,
    findOne: mocks.findOne,
  },
}));

import handler from "./reports";

function createResponse() {
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return response;
}

describe("prompt report persistence and retention visibility", () => {
  const previousAdminToken = process.env.ADMIN_REPORTS_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (previousAdminToken === undefined) {
      delete process.env.ADMIN_REPORTS_TOKEN;
    } else {
      process.env.ADMIN_REPORTS_TOKEN = previousAdminToken;
    }
  });

  it("persists submitted support evidence in MongoDB", async () => {
    mocks.create.mockResolvedValue({
      _id: "report-1",
      evidence: [{ url: "https://evidence.example/item", kind: "pdf" }],
    });
    const response = createResponse();

    await handler(
      {
        method: "POST",
        body: {
          promptId: "prompt-1",
          reporterAddress: "GREPORTER",
          reason: "copyright",
          evidence: [{ url: "https://evidence.example/item", kind: "pdf" }],
        },
      },
      response,
    );

    expect(mocks.connectDb).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterAddress: "greporter",
        evidence: [
          {
            url: "https://evidence.example/item",
            kind: "pdf",
            addedBy: "reporter",
          },
        ],
        status: "pending",
      }),
    );
    expect(response.statusCode).toBe(201);
  });

  it("hides archived reports by default and allows admin archive review", async () => {
    const sort = vi
      .fn()
      .mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    mocks.find.mockReturnValue({ sort });
    process.env.ADMIN_REPORTS_TOKEN = "test-token";

    await handler(
      {
        method: "GET",
        headers: { authorization: ["Bearer", "test-token"].join(" ") },
        query: { promptId: "prompt-1" },
      },
      createResponse(),
    );
    expect(mocks.find).toHaveBeenLastCalledWith({
      archivedAt: null,
      promptId: "prompt-1",
    });

    await handler(
      {
        method: "GET",
        headers: { authorization: ["Bearer", "test-token"].join(" ") },
        query: { promptId: "prompt-1", includeArchived: "true" },
      },
      createResponse(),
    );
    expect(mocks.find).toHaveBeenLastCalledWith({ promptId: "prompt-1" });
  });

  it("sets the resolution timestamp and maintainer attribution for closed reports", async () => {
    const report = {
      status: "investigating",
      evidence: [],
      resolvedAt: null,
      save: vi.fn().mockResolvedValue(undefined),
    };
    mocks.findOne.mockResolvedValue(report);
    const response = createResponse();

    await handler(
      {
        method: "PATCH",
        headers: { authorization: ["Bearer", "test-token"].join(" ") },
        body: {
          reportId: "report-1",
          status: "resolved",
          evidence: [{ url: "https://evidence.example/review", kind: "link" }],
        },
      },
      response,
    );

    expect(report.resolvedAt).toBeInstanceOf(Date);
    expect(report.evidence).toEqual([
      {
        url: "https://evidence.example/review",
        kind: "link",
        addedBy: "maintainer",
      },
    ]);
    expect(report.save).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(200);
  });
});
