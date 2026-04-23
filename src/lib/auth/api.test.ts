import { describe, expect, it, vi } from "vitest";
import challengeHandler from "../../../api/auth/challenge";
import unlockHandler from "../../../api/prompts/unlock";

describe("API Handlers", () => {
  describe("challenge handler", () => {
    it("returns 405 for non-POST requests", async () => {
      const req = { method: "GET" };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      await challengeHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(405);
    });

    it("returns 400 for missing address", async () => {
      const req = { method: "POST", body: { promptId: "1" } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      process.env.CHALLENGE_TOKEN_SECRET = "test-secret";
      await challengeHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("expected string") }));
    });
  });

  describe("unlock handler", () => {
    it("returns 405 for non-POST requests", async () => {
      const req = { method: "GET" };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      await unlockHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(405);
    });

    it("returns 500 if secrets are missing", async () => {
      const req = { method: "POST", body: {} };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      delete process.env.CHALLENGE_TOKEN_SECRET;
      await unlockHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
