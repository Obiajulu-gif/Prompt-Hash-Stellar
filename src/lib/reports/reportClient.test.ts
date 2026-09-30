import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReportClient, REPORT_REASONS } from "./reportClient";

describe("ReportClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("REPORT_REASONS", () => {
    it("should have all valid report reasons", () => {
      expect(REPORT_REASONS["quality-issue"]).toBe("Low quality or poor result");
      expect(REPORT_REASONS["misleading-content"]).toBe("Content doesn't match description");
      expect(REPORT_REASONS.plagiarism).toBe("Contains plagiarized content");
      expect(REPORT_REASONS["harmful-content"]).toBe("Harmful or inappropriate content");
      expect(REPORT_REASONS.copyright).toBe("Copyright violation");
      expect(REPORT_REASONS.other).toBe("Other reason");
    });
  });

  describe("submitReport", () => {
    it("should submit a report successfully", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          message: "Report submitted successfully",
          reportId: "report-123",
        }),
      });

      const result = await ReportClient.submitReport(
        "prompt-1",
        "GADDRESS123",
        "quality-issue",
        "Poor quality output"
      );

      expect(result.success).toBe(true);
      expect(result.reportId).toBe("report-123");
    });

    it("should handle network errors", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      await expect(
        ReportClient.submitReport("prompt-1", "GADDRESS123", "quality-issue")
      ).rejects.toThrow("Network error");
    });
  });

  describe("getPromptReports", () => {
    it("should fetch reports for a prompt", async () => {
      const mockReports = [
        {
          promptId: "prompt-1",
          reporterAddress: "GADDRESS1",
          reason: "quality-issue",
          description: "Poor quality",
          createdAt: new Date().toISOString(),
        },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockReports,
      });

      localStorage.setItem("adminToken", "mock-token");
      const result = await ReportClient.getPromptReports("prompt-1");

      expect(result).toEqual(mockReports);
    });

    it("should return empty array on error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Fetch error"));

      const result = await ReportClient.getPromptReports("prompt-1");

      expect(result).toEqual([]);
    });
  });
});
