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
    // Reset backoff timers
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("chat", () => {
    it("should return successful response using POST", async () => {
      const mockResponse = { response: "Hello there!" };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await AIService.chat([{ role: "user", content: "Hi" }]);

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://mock-ai-gateway.com/api/chat",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            messages: [{ role: "user", content: "Hi" }],
            model: undefined,
          }),
        }),
      );
    });

    it("should retry on failure with backoff and eventually succeed", async () => {
      const mockResponse = { response: "Success after retry" };
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        });

      const promise = AIService.chat([{ role: "user", content: "Hi" }]);
      
      // Fast-forward through the backoff timer
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries", async () => {
      const originalRetries = config.ai.maxRetries;
      config.ai.maxRetries = 0;
      (global.fetch as jest.Mock).mockRejectedValue(new Error("Persistent error"));

      await expect(AIService.chat([{ role: "user", content: "Hi" }])).rejects.toThrow("Persistent error");
      
      expect(global.fetch).toHaveBeenCalledTimes(1);
      config.ai.maxRetries = originalRetries;
    });

    it("should throw error if AI is disabled", async () => {
      config.ai.enabled = false;

      await expect(AIService.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
        "AI service is currently disabled",
      );

      config.ai.enabled = true; // reset
    });

    it("should throw error if provider URL is missing", async () => {
      const originalUrl = config.ai.providerUrl;
      config.ai.providerUrl = "";

      await expect(AIService.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
        "AI service is unconfigured",
      );

      config.ai.providerUrl = originalUrl; // reset
    });
  });

  describe("redact", () => {
    it("should redact long strings", async () => {
      // Accessing private method for testing via casting
      const redacted = (AIService as any).redact("This is a very long prompt that should be redacted for privacy.");
      expect(redacted).toContain("...[REDACTED]...");
      expect(redacted).not.toContain("very long prompt");
    });

    it("should redact short strings completely", async () => {
      const redacted = (AIService as any).redact("Short prompt");
      expect(redacted).toBe("***");
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
