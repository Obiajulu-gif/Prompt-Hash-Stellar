import { describe, it, expect } from "vitest";
import { checkRateLimit } from "../lib/observability/rateLimiter";
import { logger } from "../lib/observability/logger";

describe("Observability Utilities", () => {
  describe("Rate Limiter", () => {
    it("should allow requests within limit", async () => {
      const result = await checkRateLimit("challenge", "test-ip-1", false);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(4); // max (5) - 1
    });

    it("should block requests exceeding limit", async () => {
      // Send 5 requests to consume the limit
      for (let i = 0; i < 5; i++) {
        await checkRateLimit("challenge", "test-ip-2", false);
      }
      const result = await checkRateLimit("challenge", "test-ip-2", false);
      expect(result.success).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe("Logger", () => {
    it("should be configured with correct level", () => {
      expect(logger.level).toBe("silent"); // Since we set NODE_ENV=test
    });
  });
});
