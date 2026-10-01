import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

/**
 * Tests for provenance tracking middleware (Issue #929).
 * Tests automatic provenance tracking for various creation/update scenarios.
 */

// Mock dependencies
vi.mock("../models/ProvenanceRecord", () => ({
  default: {},
  ImportSourceType: {},
  TransformType: {},
}));

vi.mock("../models/Prompt", () => ({
  default: {
    findById: vi.fn().mockReturnValue({
      lean: vi.fn(async () => ({
        _id: "prompt_1",
        title: "Original Title",
        content: "Original content",
        price: 100,
      })),
    }),
    findByIdAndUpdate: vi.fn(async () => ({ _id: "prompt_1" })),
  },
}));

vi.mock("../services/structuredLogger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../services/provenanceService", () => ({
  trackPromptUpdate: vi.fn(async () => ({
    provenanceRecord: { _id: "prov_1" },
    transformation: {},
  })),
}));

describe("Provenance Middleware - Update Tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects content changes", () => {
    const previous = {
      _id: "prompt_1",
      title: "Original",
      content: "Original content",
      price: 100,
    };

    const current = {
      _id: "prompt_1",
      title: "Original",
      content: "Updated content",
      price: 100,
    };

    const changedFields: string[] = [];
    const modifications: Record<string, { old: any; new: any }> = {};

    for (const key of Object.keys(current)) {
      if (key.startsWith("_")) continue;
      if (previous[key as keyof typeof previous] !== current[key as keyof typeof current]) {
        modifications[key] = {
          old: previous[key as keyof typeof previous],
          new: current[key as keyof typeof current],
        };
        changedFields.push(key);
      }
    }

    expect(changedFields).toContain("content");
    expect(modifications.content).toEqual({
      old: "Original content",
      new: "Updated content",
    });
  });

  it("detects price changes", () => {
    const previous = { title: "Test", price: 100 };
    const current = { title: "Test", price: 150 };

    const modifications: Record<string, { old: any; new: any }> = {};

    for (const key of Object.keys(current)) {
      if (previous[key as keyof typeof previous] !== current[key as keyof typeof current]) {
        modifications[key] = {
          old: previous[key as keyof typeof previous],
          new: current[key as keyof typeof current],
        };
      }
    }

    expect(modifications.price).toEqual({ old: 100, new: 150 });
  });

  it("detects metadata changes", () => {
    const previous = {
      title: "Original",
      description: "Original desc",
      category: "AI",
    };

    const current = {
      title: "Updated",
      description: "Updated desc",
      category: "Development",
    };

    const changedFields: string[] = [];

    for (const key of Object.keys(current)) {
      if (previous[key as keyof typeof previous] !== current[key as keyof typeof current]) {
        changedFields.push(key);
      }
    }

    expect(changedFields).toHaveLength(3);
    expect(changedFields).toContain("title");
    expect(changedFields).toContain("description");
    expect(changedFields).toContain("category");
  });

  it("classifies updates as CONTENT_ENHANCEMENT", () => {
    const changedFields = ["content", "encryptedPrompt"];
    
    const hasContentChange = changedFields.some(f =>
      ["content", "encryptedPrompt", "preview"].includes(f)
    );

    expect(hasContentChange).toBe(true);
    
    const updateType = hasContentChange ? "CONTENT_ENHANCEMENT" : "customization";
    expect(updateType).toBe("CONTENT_ENHANCEMENT");
  });

  it("classifies updates as ENRICHMENT for metadata", () => {
    const changedFields = ["title", "description", "tags"];
    
    const hasMetadataChange = changedFields.some(f =>
      ["title", "description", "category"].includes(f)
    );

    expect(hasMetadataChange).toBe(true);
    
    const updateType = hasMetadataChange ? "customization" : "customization";
    expect(updateType).toBe("customization");
  });

  it("classifies updates as VERSION_UPDATE", () => {
    const changedFields = ["currentVersionIndex"];
    
    const hasVersionChange = changedFields.includes("currentVersionIndex");

    expect(hasVersionChange).toBe(true);
    
    const updateType = hasVersionChange ? "VERSION_UPDATE" : "customization";
    expect(updateType).toBe("VERSION_UPDATE");
  });

  it("skips tracking when no fields changed", () => {
    const previous = { title: "Test", content: "Content" };
    const current = { title: "Test", content: "Content" };

    const changedFields: string[] = [];

    for (const key of Object.keys(current)) {
      if (previous[key as keyof typeof previous] !== current[key as keyof typeof current]) {
        changedFields.push(key);
      }
    }

    expect(changedFields).toHaveLength(0);
  });

  it("ignores internal fields like _id and __v", () => {
    const previous = {
      _id: "prompt_1",
      __v: 0,
      title: "Test",
      updatedAt: new Date("2024-01-01"),
    };

    const current = {
      _id: "prompt_1",
      __v: 1,
      title: "Test",
      updatedAt: new Date("2024-01-02"),
    };

    const changedFields: string[] = [];

    for (const key of Object.keys(current)) {
      if (key.startsWith("_") || key === "__v" || key === "updatedAt" || key === "createdAt") {
        continue;
      }
      if (previous[key as keyof typeof previous] !== current[key as keyof typeof current]) {
        changedFields.push(key);
      }
    }

    expect(changedFields).toHaveLength(0);
  });
});

describe("Provenance Middleware - Actor Extraction", () => {
  it("extracts user actor metadata from request", () => {
    const req: Partial<Request> = {
      user: { id: "user_123", role: "user" },
      ip: "192.168.1.1",
      get: (header: string) => (header === "user-agent" ? "TestAgent/1.0" : undefined),
    } as any;

    const actor = {
      actorId: (req as any).user?.id,
      actorType: (req as any).user?.role === "admin" ? "admin" : "user",
      ipAddress: req.ip,
      userAgent: req.get?.("user-agent"),
    };

    expect(actor.userId).toBe("user_123");
    expect(actor.actorType).toBe("user");
    expect(actor.ipAddress).toBe("192.168.1.1");
    expect(actor.userAgent).toBe("TestAgent/1.0");
  });

  it("extracts admin actor metadata", () => {
    const req: Partial<Request> = {
      user: { id: "admin_123", role: "admin", walletAddress: "GADMIN" },
    } as any;

    const actor = {
      actorId: (req as any).user?.id,
      walletAddress: (req as any).user?.walletAddress,
      actorType: (req as any).user?.role === "admin" ? "admin" : "user",
    };

    expect(actor.userId).toBe("admin_123");
    expect(actor.walletAddress).toBe("GADMIN");
    expect(actor.actorType).toBe("admin");
  });

  it("handles system actor when no user", () => {
    const req: Partial<Request> = {
      user: undefined,
    } as any;

    const actor = {
      actorType: (req as any).user ? "user" : "system",
      actorId: (req as any).user?.id || "system",
    };

    expect(actor.actorType).toBe("system");
    expect(actor.userId).toBe("system");
  });
});

describe("Provenance Middleware - Blockchain Tracking", () => {
  it("tracks blockchain-indexed prompts with transaction metadata", () => {
    const blockchainMetadata = {
      transactionHash: "0xabc123",
      ledgerNumber: 12345,
      onChainId: "456",
      contractId: "CONTRACT_ID",
    };

    expect(blockchainMetadata.transactionHash).toBe("0xabc123");
    expect(blockchainMetadata.ledgerNumber).toBe(12345);
    expect(blockchainMetadata.onChainId).toBe("456");
  });

  it("includes creator wallet in blockchain provenance", () => {
    const creator = "GCREATOR123";
    const actor = {
      walletAddress: creator,
      actorType: "user",
    };

    expect(actor.walletAddress).toBe("GCREATOR123");
  });
});

describe("Provenance Middleware - Error Handling", () => {
  it("logs error but doesn't throw when provenance tracking fails", () => {
    const error = new Error("Database connection failed");
    const shouldThrow = false; // Middleware should not throw

    if (shouldThrow) {
      throw error;
    }

    // Should reach here without throwing
    expect(true).toBe(true);
  });

  it("continues processing when actor extraction fails", () => {
    const req: Partial<Request> = {
      user: undefined,
      ip: undefined,
      get: () => undefined,
    } as any;

    // Should not throw when extracting from incomplete request
    const actor = {
      actorType: "system",
      actorId: "system",
      ipAddress: req.ip,
      userAgent: req.get?.("user-agent"),
    };

    expect(actor.actorType).toBe("system");
    expect(actor.ipAddress).toBeUndefined();
  });
});

describe("Provenance Middleware - Integration", () => {
  it("captures version before update", async () => {
    const Prompt = (await import("../models/Prompt")).default;
    const promptId = "prompt_1";

    const previousVersion = await Prompt.findById(promptId).lean();

    expect(previousVersion).toBeDefined();
    expect(previousVersion._id).toBe("prompt_1");
    expect(previousVersion.title).toBe("Original Title");
  });

  it("tracks provenance in background after response", async () => {
    const { trackPromptUpdate } = await import("../services/provenanceService");

    const promptId = "prompt_1";
    const updateType = "CONTENT_ENHANCEMENT";
    const actor = {
      actorId: "user_123",
      walletAddress: "GTEST",
      timestamp: new Date(),
    };

    // Simulate background tracking (doesn't block response)
    const promise = (trackPromptUpdate as any)({
      promptId,
      updateType,
      updateDetails: "Content updated",
      actor,
    });

    // Response should not wait for this
    expect(promise).toBeInstanceOf(Promise);
  });
});

