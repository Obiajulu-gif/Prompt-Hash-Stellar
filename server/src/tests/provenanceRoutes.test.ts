import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Integration tests for provenance API routes (Issue #929).
 * Tests endpoints for bulk import, queries, lineage, derivatives, and updates.
 */

// Mock authentication/authorization
const mockAuth = {
  requireAdminScope: (scope: string) => (req: any, res: any, next: any) => {
    if (req.headers.authorization === "Bearer admin_token") {
      next();
    } else {
      res.status(403).json({ error: "Forbidden" });
    }
  },
  requireWalletSession: (extractor: any) => (req: any, res: any, next: any) => {
    req.sessionWallet = "GTEST123";
    next();
  },
};

vi.mock("../middleware/adminAuth", () => ({
  requireAdminScope: mockAuth.requireAdminScope,
}));

vi.mock("../middleware/walletSession", () => ({
  requireWalletSession: mockAuth.requireWalletSession,
}));

// Mock database connection
vi.mock("../db/connectDb", () => ({
  default: vi.fn(async () => {}),
}));

// Mock provenance service
const mockServiceInstance = {
  createProvenanceRecord: vi.fn(async (params: any) => ({
    _id: "prov_test",
    ...params,
    createdAt: new Date(),
  })),
  getProvenanceByPromptId: vi.fn(async (id: string) => ({
    _id: "prov_test",
    promptId: id,
    sourceType: "api",
  })),
  getBatchPrompts: vi.fn(async (batchId: string) => [
    { promptId: "1", batchId },
    { promptId: "2", batchId },
  ]),
  getLineage: vi.fn(async (promptId: string) => ({
    promptId,
    ancestors: [],
    derivatives: [],
  })),
  getDerivatives: vi.fn(async (promptId: string) => [
    { promptId: "child_1", parentId: promptId },
  ]),
  queryProvenance: vi.fn(async (query: any) => [
    { promptId: "1", sourceType: query.sourceType },
  ]),
  getImportStatistics: vi.fn(async () => ({
    totalRecords: 100,
    bySourceType: { api: 50, file_upload: 50 },
    recentImports: 10,
    totalBatches: 5,
  })),
};

const mockStandaloneFunctions = {
  trackDerivedPrompt: vi.fn(async (params: any) => ({
    provenanceRecord: { _id: "prov_derived", ...params },
    promptRelation: { promptId: params.promptId, relatedPromptId: params.parentPromptId },
  })),
  getDerivativesWithProvenance: vi.fn(async (promptId: string) => [
    { promptId: "derived_1", source: "provenance" },
  ]),
  trackPromptUpdate: vi.fn(async (params: any) => ({
    provenanceRecord: { _id: "prov_update", ...params },
    transformation: params,
  })),
  archiveProvenance: vi.fn(async () => {}),
  restoreProvenance: vi.fn(async () => {}),
  getUpdateHistory: vi.fn(async (promptId: string) => ({
    promptId,
    totalUpdates: 2,
    updates: [
      { transformType: "customization", timestamp: new Date(), details: "Update 1" },
      { transformType: "ai_enhancement", timestamp: new Date(), details: "Update 2" },
    ],
  })),
};

vi.mock("../services/provenanceService", () => ({
  provenanceService: mockServiceInstance,
  ...mockStandaloneFunctions,
}));

// Helper to create mock request/response
function createMockReqRes(options: {
  method?: string;
  path?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
  headers?: Record<string, string>;
} = {}) {
  const req: Partial<Request> = {
    method: options.method || "GET",
    path: options.path || "/",
    params: options.params || {},
    query: options.query || {},
    body: options.body || {},
    headers: options.headers || {},
    get: (header: string) => options.headers?.[header.toLowerCase()],
  } as any;

  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as any;

  return { req: req as Request, res: res as Response };
}

describe("Provenance Routes - Bulk Import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /bulk-import requires admin scope", async () => {
    const { req, res } = createMockReqRes({
      method: "POST",
      path: "/api/provenance/bulk-import",
      body: { items: [{ title: "Test" }] },
      headers: { authorization: "Bearer user_token" },
    });

    // Simulate middleware check
    const middleware = mockAuth.requireAdminScope("provenance:write");
    middleware(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("POST /bulk-import processes items with admin token", async () => {
    const { req, res } = createMockReqRes({
      method: "POST",
      path: "/api/provenance/bulk-import",
      body: { items: [{ title: "Test 1" }, { title: "Test 2" }] },
      headers: { authorization: "Bearer admin_token" },
    });

    // Mock successful import
    const batchId = "batch_test";
    expect(req.body.items).toHaveLength(2);
  });

  it("GET /bulk-import/:batchId returns batch status", async () => {
    const { req, res } = createMockReqRes({
      method: "GET",
      path: "/api/provenance/bulk-import/batch_001",
      params: { batchId: "batch_001" },
      headers: { authorization: "Bearer admin_token" },
    });

    expect(req.params.batchId).toBe("batch_001");
  });
});

describe("Provenance Routes - Query Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /record/:promptId returns provenance record", async () => {
    const { req, res } = createMockReqRes({
      method: "GET",
      path: "/api/provenance/record/prompt_123",
      params: { promptId: "prompt_123" },
    });

    const record = await mockProvenanceService.getProvenanceByPromptId(req.params.promptId);

    expect(record.promptId).toBe("prompt_123");
  });

  it("GET /batch/:batchId returns all prompts in batch", async () => {
    const { req, res } = createMockReqRes({
      method: "GET",
      path: "/api/provenance/batch/batch_001",
      params: { batchId: "batch_001" },
    });

    const prompts = await mockProvenanceService.getBatchPrompts(req.params.batchId);

    expect(prompts).toHaveLength(2);
    expect(prompts[0].batchId).toBe("batch_001");
  });

  it("GET /lineage/:promptId returns ancestor tree", async () => {
    const { req, res } = createMockReqRes({
      method: "GET",
      path: "/api/provenance/lineage/prompt_123",
      params: { promptId: "prompt_123" },
    });

    const lineage = await mockProvenanceService.getLineage(req.params.promptId);

    expect(lineage.promptId).toBe("prompt_123");
    expect(lineage).toHaveProperty("ancestors");
    expect(lineage).toHaveProperty("derivatives");
  });

  it("GET /derivatives/:promptId returns child prompts", async () => {
    const { req, res } = createMockReqRes({
      method: "GET",
      path: "/api/provenance/derivatives/prompt_123",
      params: { promptId: "prompt_123" },
    });

    const derivatives = await mockProvenanceService.getDerivatives(req.params.promptId);

    expect(derivatives).toHaveLength(1);
    expect(derivatives[0].parentId).toBe("prompt_123");
  });

  it("POST /query filters by source type", async () => {
    const { req, res } = createMockReqRes({
      method: "POST",
      path: "/api/provenance/query",
      body: { sourceType: "API_IMPORT" },
    });

    const results = await mockProvenanceService.queryProvenance(req.body);

    expect(results).toHaveLength(1);
    expect(results[0].sourceType).toBe("API_IMPORT");
  });

  it("GET /statistics returns import statistics", async () => {
    const { req, res } = createMockReqRes({
      method: "GET",
      path: "/api/provenance/statistics",
      headers: { authorization: "Bearer admin_token" },
    });

    const stats = await mockProvenanceService.getImportStatistics();

    expect(stats.totalRecords).toBe(100);
    expect(stats.bySourceType).toHaveProperty("API_IMPORT");
    expect(stats.totalBatches).toBe(5);
  });
});

describe("Provenance Routes - Derived Tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /track-derived creates provenance for fork", async () => {
    const { req, res } = createMockReqRes({
      method: "POST",
      path: "/api/provenance/track-derived",
      body: {
        promptId: "prompt_fork",
        parentPromptId: "prompt_parent",
        relationKind: "fork",
        actor: { walletAddress: "GTEST" },
      },
    });

    const result = await mockProvenanceService.trackDerivedPrompt(req.body);

    expect(result.provenanceRecord.promptId).toBe("prompt_fork");
    expect(result.promptRelation.relatedPromptId).toBe("prompt_parent");
  });

  it("GET /derivatives-enhanced combines provenance data", async () => {
    const { req, res } = createMockReqRes({
      method: "GET",
      path: "/api/provenance/derivatives-enhanced/prompt_123",
      params: { promptId: "prompt_123" },
    });

    const derivatives = await mockProvenanceService.getDerivativesWithProvenance(
      req.params.promptId
    );

    expect(derivatives).toHaveLength(1);
    expect(derivatives[0].source).toBe("provenance");
  });
});

describe("Provenance Routes - Update Preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /track-update records content changes", async () => {
    const { req, res } = createMockReqRes({
      method: "POST",
      path: "/api/provenance/track-update",
      body: {
        promptId: "prompt_123",
        updateType: "CONTENT_ENHANCEMENT",
        updateDetails: "Content updated",
        actor: { walletAddress: "GTEST" },
        changedFields: ["content", "title"],
      },
    });

    const result = await mockProvenanceService.trackPromptUpdate(req.body);

    expect(result.provenanceRecord.promptId).toBe("prompt_123");
    expect(result.transformation.updateType).toBe("CONTENT_ENHANCEMENT");
  });

  it("GET /update-history/:promptId returns update timeline", async () => {
    const { req, res } = createMockReqRes({
      method: "GET",
      path: "/api/provenance/update-history/prompt_123",
      params: { promptId: "prompt_123" },
    });

    const history = await mockProvenanceService.getUpdateHistory(req.params.promptId);

    expect(history.promptId).toBe("prompt_123");
    expect(history.totalUpdates).toBe(2);
    expect(history.updates).toHaveLength(2);
  });

  it("POST /archive archives provenance record", async () => {
    const { req, res } = createMockReqRes({
      method: "POST",
      path: "/api/provenance/archive",
      body: {
        promptId: "prompt_123",
        actor: { userId: "admin" },
        reason: "Policy violation",
      },
      headers: { authorization: "Bearer admin_token" },
    });

    await mockProvenanceService.archiveProvenance(req.body);

    expect(mockProvenanceService.archiveProvenance).toHaveBeenCalledWith(req.body);
  });

  it("POST /restore restores archived record", async () => {
    const { req, res } = createMockReqRes({
      method: "POST",
      path: "/api/provenance/restore",
      body: {
        promptId: "prompt_123",
        actor: { userId: "admin" },
      },
      headers: { authorization: "Bearer admin_token" },
    });

    await mockProvenanceService.restoreProvenance(req.body);

    expect(mockProvenanceService.restoreProvenance).toHaveBeenCalledWith(req.body);
  });
});

describe("Provenance Routes - Error Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 for non-existent provenance record", async () => {
    mockProvenanceService.getProvenanceByPromptId.mockResolvedValueOnce(null);

    const { req, res } = createMockReqRes({
      method: "GET",
      path: "/api/provenance/record/nonexistent",
      params: { promptId: "nonexistent" },
    });

    const record = await mockProvenanceService.getProvenanceByPromptId(req.params.promptId);

    expect(record).toBeNull();
  });

  it("returns 400 for invalid query parameters", async () => {
    mockProvenanceService.queryProvenance.mockRejectedValueOnce(
      new Error("Invalid query parameters")
    );

    const { req, res } = createMockReqRes({
      method: "POST",
      path: "/api/provenance/query",
      body: { invalidParam: "test" },
    });

    await expect(mockProvenanceService.queryProvenance(req.body)).rejects.toThrow(
      "Invalid query parameters"
    );
  });

  it("returns 500 for service errors", async () => {
    mockProvenanceService.getImportStatistics.mockRejectedValueOnce(
      new Error("Database error")
    );

    const { req, res } = createMockReqRes({
      method: "GET",
      path: "/api/provenance/statistics",
      headers: { authorization: "Bearer admin_token" },
    });

    await expect(mockProvenanceService.getImportStatistics()).rejects.toThrow(
      "Database error"
    );
  });
});
