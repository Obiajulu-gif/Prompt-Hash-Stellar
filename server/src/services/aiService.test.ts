import { AIService } from "./aiService";
import { config } from "../config";

// Mock fetch globally
global.fetch = jest.fn();

// Mock config
jest.mock("../config", () => ({
  config: {
    ai: {
      providerUrl: "https://mock-ai-gateway.com",
      apiKey: "mock-key",
      timeoutMs: 100,
      maxRetries: 2,
      enabled: true,
    },
  },
}));

describe("AIService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe("chat", () => {
    it("should return successful response", async () => {
      const mockResponse = { response: "Hello there!" };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await AIService.chat([{ role: "user", content: "Hi" }]);

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("https://mock-ai-gateway.com/api/chat?prompt=Hi"),
        expect.any(Object),
      );
    });

    it("should retry on failure and eventually succeed", async () => {
      const mockResponse = { response: "Success after retry" };
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        });

      const result = await AIService.chat([{ role: "user", content: "Hi" }]);

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error("Persistent error"));

      await expect(AIService.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
        "Persistent error",
      );
      // initial call + 2 retries = 3 calls
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("should throw error if AI is disabled", async () => {
      config.ai.enabled = false;

      await expect(AIService.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
        "AI service is currently disabled",
      );

      config.ai.enabled = true; // reset for other tests
    });
  });

  describe("improvePrompt", () => {
    it("should call improve-prompt endpoint with POST", async () => {
      const mockResponse = { improved: "Better prompt" };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await AIService.improvePrompt("Bad prompt");

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://mock-ai-gateway.com/api/improve-prompt",
        expect.objectContaining({
          method: "POST",
          body: "Bad prompt",
        }),
      );
    });
  });
});
