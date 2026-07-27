import { Request, Response } from "express";
import { GetPrompts } from "../controllers/controllers";
import Prompt from "../models/Prompt";

jest.mock("../models/Prompt", () => {
  const mockFind = jest.fn();
  const mockPopulate = jest.fn();
  const mockSort = jest.fn();
  const mockLimit = jest.fn();

  const mockChain = {
    populate: mockPopulate,
    sort: mockSort,
    limit: mockLimit,
  };

  mockFind.mockReturnValue(mockChain);
  mockPopulate.mockReturnValue(mockChain);
  mockSort.mockReturnValue(mockChain);
  mockLimit.mockResolvedValue([]);

  return {
    __esModule: true,
    default: {
      find: mockFind,
      __chain: mockChain,
    },
  };
});

jest.mock("../db/connectDb", () => jest.fn().mockResolvedValue(true));

const mockFind = Prompt.find as jest.Mock;
const mockChain = (Prompt as any).__chain;

describe("Pagination logic - GetPrompts", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      url: "/",
      query: { limit: "2" },
      headers: { host: "localhost" },
    };
    res = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };
    
    mockFind.mockReturnValue(mockChain);
    mockChain.populate.mockReturnValue(mockChain);
    mockChain.sort.mockReturnValue(mockChain);
  });

  it("returns nextCursor when results exceed limit", async () => {
    // 3 items returned for limit 2 (because controller asks for limit + 1)
    const fakePrompts = [
      { _id: "3", title: "C" },
      { _id: "2", title: "B" },
      { _id: "1", title: "A" },
    ];
    
    mockChain.limit.mockResolvedValue([...fakePrompts]);

    await GetPrompts(req as Request, res as Response);

    expect(mockChain.limit).toHaveBeenCalledWith(3); // limit 2 + 1
    
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [
        { _id: "3", title: "C" },
        { _id: "2", title: "B" }
      ],
      metadata: {
        hasNextPage: true,
        nextCursor: "2"
      }
    }));
  });

  it("returns null nextCursor when results are within limit", async () => {
    // 2 items returned for limit 2
    const fakePrompts = [
      { _id: "3", title: "C" },
      { _id: "2", title: "B" },
    ];
    
    mockChain.limit.mockResolvedValue([...fakePrompts]);

    await GetPrompts(req as Request, res as Response);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: fakePrompts,
      metadata: {
        hasNextPage: false,
        nextCursor: null
      }
    }));
  });

  it("handles inserts occurring between page requests properly by using cursor", async () => {
    // Simulating user fetches page 1, gets nextCursor "2"
    // Then an item is inserted: _id "4"
    // User fetches page 2 using cursor "2"
    req.query = { limit: "2", cursor: "2" };

    const fakePrompts = [
      { _id: "1", title: "A" },
    ];
    
    mockChain.limit.mockResolvedValue([...fakePrompts]);

    await GetPrompts(req as Request, res as Response);

    expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({
      _id: { $lt: "2" }
    }));

    // Data from before the cursor is fetched, new item "4" is safely ignored
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: fakePrompts,
      metadata: {
        hasNextPage: false,
        nextCursor: null
      }
    }));
  });
});
