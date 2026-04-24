import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRateLimit } from "../lib/observability/rateLimiter";
import { logger } from "../lib/observability/logger";

describe("Observability Utilities", () => {
  describe("Rate Limiter", () => {
    it("should allow requests within limit", () => {
      const result = checkRateLimit("challenge", "test-ip-1", { max: 2, windowMs: 1000 });
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it("should block requests exceeding limit", () => {
      checkRateLimit("challenge", "test-ip-2", { max: 1, windowMs: 1000 });
      const result = checkRateLimit("challenge", "test-ip-2", { max: 1, windowMs: 1000 });
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
