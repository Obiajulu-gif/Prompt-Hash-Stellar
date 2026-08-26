import { describe, it, expect, vi, beforeEach } from "vitest";
import { redact, logger } from "../services/structuredLogger";

describe("structuredLogger", () => {
  describe("redact", () => {
    it("redacts sensitive string values", () => {
      const input = { password: "mysecretpassword123" };
      const result = redact(input) as Record<string, unknown>;
      expect(result.password).toBe("[REDACTED]");
    });

    it("redacts nested sensitive values", () => {
      const input = {
        user: {
          name: "John",
          wallet: "0x1234567890abcdef",
          secret: "abc123",
        },
      };
      const result = redact(input) as Record<string, unknown>;
      const user = result.user as Record<string, unknown>;
      expect(user.name).toBe("John");
      expect(user.wallet).toBe("[REDACTED]");
      expect(user.secret).toBe("[REDACTED]");
    });

    it("redacts arrays containing sensitive data", () => {
      const input = {
        tokens: ["token123", "token456"],
        safe: ["hello", "world"],
      };
      const result = redact(input) as Record<string, unknown>;
      expect(result.tokens).toEqual(["[REDACTED]", "[REDACTED]"]);
      expect(result.safe).toEqual(["hello", "world"]);
    });

    it("preserves non-sensitive values", () => {
      const input = {
        name: "test",
        count: 42,
        active: true,
        nested: { foo: "bar" },
      };
      const result = redact(input) as Record<string, unknown>;
      expect(result.name).toBe("test");
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
      expect(result.nested).toEqual({ foo: "bar" });
    });

    it("handles null and undefined", () => {
      expect(redact(null)).toBeNull();
      expect(redact(undefined)).toBeUndefined();
    });

    it("redacts wallet addresses", () => {
      const input = {
        walletAddress: "GDXSEH3V6V7K4J3L5M6N",
        from: "0xabcdef",
        to: "0x123456",
      };
      const result = redact(input) as Record<string, unknown>;
      expect(result.walletAddress).toBe("[REDACTED]");
      expect(result.from).toBe("[REDACTED]");
      expect(result.to).toBe("[REDACTED]");
    });

    it("redacts prompt content", () => {
      const input = {
        prompt: "You are a helpful assistant",
        content: "Secret prompt content",
        previewPrompt: "Test prompt",
      };
      const result = redact(input) as Record<string, unknown>;
      expect(result.prompt).toBe("[REDACTED]");
      expect(result.content).toBe("[REDACTED]");
      expect(result.previewPrompt).toBe("[REDACTED]");
    });

    it("redacts authentication tokens", () => {
      const input = {
        token: "Bearer abc123",
        authorization: "Basic xyz789",
        apiKey: "sk-123456",
      };
      const result = redact(input) as Record<string, unknown>;
      expect(result.token).toBe("[REDACTED]");
      expect(result.authorization).toBe("[REDACTED]");
      expect(result.apiKey).toBe("[REDACTED]");
    });
  });

  describe("logger", () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    });

    it("logs info messages", () => {
      logger.info("test message", { action: "test" });
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("redacts sensitive data in log context", () => {
      logger.info("test", { wallet: "0x1234567890" });
      const call = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(call);
      expect(parsed.context.wallet).toBe("[REDACTED]");
    });
  });
});
