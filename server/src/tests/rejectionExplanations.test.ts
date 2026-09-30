import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock modules
vi.mock("../db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(true),
}));

vi.mock("../models/Prompt", () => ({
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  lean: vi.fn().mockResolvedValue({}),
  exec: vi.fn().mockResolvedValue({}),
}));

vi.mock("../models/User", () => ({
  findOne: vi.fn(),
  create: vi.fn().mockResolvedValue({ _id: "user-1", walletAddress: "test-wallet" }),
}));

import { REJECTION_EXPLANATIONS, getRejectionExplanation, mapFailureToRejection } from "../services/rejectionExplanations";
import type { RejectionCode, RejectionExplanation } from "../services/rejectionExplanations";

describe("Rejection Explanations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("REJECTION_EXPLANATIONS object", () => {
    it("should have all rejection code types defined", () => {
      const codes: RejectionCode[] = [
        "validation",
        "permission_denied",
        "policy_violation",
        "stale_state",
        "external_service",
        "not_found",
        "conflict",
        "rate_limited",
      ];

      for (const code of codes) {
        expect(REJECTION_EXPLANATIONS).toHaveProperty(code);
      }
    });

    it("each explanation should have required fields", () => {
      const codes: RejectionCode[] = [
        "validation",
        "permission_denied",
        "policy_violation",
        "stale_state",
        "external_service",
        "not_found",
        "conflict",
        "rate_limited",
      ];

      for (const code of codes) {
        const explanation = REJECTION_EXPLANATIONS[code];
        expect(explanation).toHaveProperty("code");
        expect(explanation).toHaveProperty("reason");
        expect(explanation).toHaveProperty("message");
        expect(explanation).toHaveProperty("hint");
        expect(explanation).toHaveProperty("status");
      }
    });

    it("status codes should be appropriate for each rejection type", () => {
      const statuses: Record<RejectionCode, number> = {
        validation: 400,
        permission_denied: 403,
        policy_violation: 403,
        stale_state: 409,
        external_service: 502,
        not_found: 404,
        conflict: 409,
        rate_limited: 429,
      };

      for (const [code, expectedStatus] of Object.entries(statuses)) {
        const explanation = REJECTION_EXPLANATIONS[code as RejectionCode];
        expect(explanation.status).toBe(expectedStatus);
      }
    });

    it("should have user-safe and actionable hints", () => {
      for (const code of Object.keys(REJECTION_EXPLANATIONS) as RejectionCode[]) {
        const explanation = REJECTION_EXPLANATIONS[code];
        // Hints should not be empty and should be actionable
        expect(explanation.hint).toBeTruthy();
        expect(typeof explanation.hint).toBe("string");
        expect(explanation.hint.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getRejectionExplanation", () => {
    it("should return explanation for valid code", () => {
      const explanation = getRejectionExplanation("validation");
      expect(explanation.code).toBe("validation");
      expect(explanation.message).toBe("Invalid input provided");
      expect(explanation.hint).toBe("Check the request parameters and try again.");
    });

    it("should return not_found fallback for unknown code", () => {
      const explanation = getRejectionExplanation("unknown_code" as RejectionCode);
      expect(explanation.code).toBe("not_found");
      expect(explanation.message).toContain("resource could not be found");
    });
  });

  describe("mapFailureToRejection", () => {
    it("should map validation errors", () => {
      const error = new Error("Invalid field value") as any;
      error.code = "VALIDATION_ERROR";
      error.status = 400;

      const result = mapFailureToRejection(error);
      expect(result.code).toBe("validation_error");
      expect(result.status).toBe(400);
    });

    it("should map permission denied errors", () => {
      const error = new Error("Forbidden") as any;
      error.code = "FORBIDDEN";
      error.status = 403;

      const result = mapFailureToRejection(error);
      expect(result.code).toBe("insufficient_permission");
      expect(result.status).toBe(403);
    });

    it("should map not found errors", () => {
      const error = new Error("Not found") as any;
      error.code = "NOT_FOUND";
      error.status = 404;

      const result = mapFailureToRejection(error);
      expect(result.code).toBe("resource_not_found");
      expect(result.status).toBe(404);
    });

    it("should map conflict errors", () => {
      const error = new Error("Conflict") as any;
      error.code = "CONFLICT";
      error.status = 409;

      const result = mapFailureToRejection(error);
      expect(result.code).toBe("resource_conflict");
      expect(result.status).toBe(409);
    });

    it("should map rate limited errors", () => {
      const error = new Error("Rate limit") as any;
      error.code = "RATE_LIMIT";
      error.status = 429;

      const result = mapFailureToRejection(error);
      expect(result.code).toBe("rate_limit_exceeded");
      expect(result.status).toBe(429);
    });

    it("should map external service errors", () => {
      const error = new Error("Service unavailable") as any;
      error.code = "EXTERNAL_TIMEOUT";
      error.status = 502;

      const result = mapFailureToRejection(error);
      expect(result.code).toBe("external_service_unavailable");
      expect(result.status).toBe(502);
    });

    it("should fall back to not_found for unknown error codes", () => {
      const error = new Error("Unknown error") as any;
      error.code = "UNKNOWN_CODE";

      const result = mapFailureToRejection(error);
      expect(result.code).toBe("resource_not_found");
      expect(result.status).toBe(404);
    });

    it("should preserve custom status if provided", () => {
      const error = new Error("Test error") as any;
      error.code = "VALIDATION_ERROR";
      error.status = 400;

      const result = mapFailureToRejection(error, 400);
      expect(result.status).toBe(400);
    });
  });
});