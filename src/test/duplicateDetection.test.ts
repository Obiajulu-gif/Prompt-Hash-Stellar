import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindLean, mockFind } = vi.hoisted(() => {
  const mLean = vi.fn();
  return {
    mockFindLean: mLean,
    mockFind: vi.fn(() => ({ lean: () => ({ limit: mLean }) })),
  };
});

vi.mock("../../server/src/models/Prompt.js", () => ({
  default: {
    find: mockFind,
  },
}));

const { mockCheckSimilarity } = vi.hoisted(() => {
  return {
    mockCheckSimilarity: vi.fn(),
  };
});

vi.mock("../../server/src/services/similarityDetection.js", () => ({
  checkSimilarityForContent: mockCheckSimilarity,
}));

import { checkDuplicates, generateCanonicalKey } from "../../server/src/services/duplicateDetection";

beforeEach(() => {
  vi.clearAllMocks();
  mockFind.mockReturnValue({ lean: () => ({ limit: mockFindLean }) });
  mockFindLean.mockResolvedValue([]);
  mockCheckSimilarity.mockResolvedValue({ flag: "clean", score: 0.1, similarTo: null });
});

describe("duplicateDetection", () => {
  describe("generateCanonicalKey", () => {
    it("generates the same key for identical content regardless of case/whitespace padding", () => {
      const key1 = generateCanonicalKey(" My Title ", " Some content ");
      const key2 = generateCanonicalKey("my title", "some content");
      expect(key1).toBe(key2);
    });

    it("generates different keys for different content", () => {
      const key1 = generateCanonicalKey("Title", "Content");
      const key2 = generateCanonicalKey("Title2", "Content");
      expect(key1).not.toBe(key2);
    });
  });

  describe("checkDuplicates", () => {
    it("detects exact duplicate deterministically", async () => {
      mockFindLean.mockResolvedValueOnce([{ onChainId: "123" }]);
      
      const result = await checkDuplicates("Title", "Content", "Other");
      
      expect(result.severity).toBe("exact");
      expect(result.similarTo).toBe("123");
      expect(result.score).toBe(1.0);
    });

    it("detects ambiguous duplicate (near duplicate) via similarity scanner", async () => {
      mockFindLean.mockResolvedValueOnce([]); // No exact match
      mockCheckSimilarity.mockResolvedValueOnce({ flag: "highly_similar", score: 0.95, similarTo: "456" });
      
      const result = await checkDuplicates("Title", "Content", "Other");
      
      expect(result.severity).toBe("ambiguous");
      expect(result.similarTo).toBe("456");
      expect(result.score).toBe(0.95);
    });

    it("detects false positive/allowed duplicate as clean", async () => {
      mockFindLean.mockResolvedValueOnce([]); // No exact match
      mockCheckSimilarity.mockResolvedValueOnce({ flag: "clean", score: 0.4, similarTo: null });
      
      const result = await checkDuplicates("Title", "Content", "Other");
      
      expect(result.severity).toBe("none");
      expect(result.similarTo).toBeNull();
      expect(result.score).toBe(0.4);
    });

    it("supports review resolution behavior (suspicious -> ambiguous)", async () => {
      mockFindLean.mockResolvedValueOnce([]); // No exact match
      mockCheckSimilarity.mockResolvedValueOnce({ flag: "suspicious", score: 0.8, similarTo: "789" });
      
      const result = await checkDuplicates("Title", "Content", "Other");
      
      expect(result.severity).toBe("ambiguous");
      expect(result.similarTo).toBe("789");
      expect(result.score).toBe(0.8);
    });
  });
});
