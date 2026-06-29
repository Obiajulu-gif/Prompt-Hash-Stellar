export type ReportReason =
  | "quality-issue"
  | "misleading-content"
  | "plagiarism"
  | "harmful-content"
  | "copyright"
  | "other";

export const REPORT_REASONS: Record<ReportReason, string> = {
  "quality-issue": "Low quality or poor result",
  "misleading-content": "Content doesn't match description",
  plagiarism: "Contains plagiarized content",
  "harmful-content": "Harmful or inappropriate content",
  copyright: "Copyright violation",
  other: "Other reason",
};

export interface PromptReport {
  promptId: string;
  reporterAddress: string;
  reason: ReportReason;
  description?: string;
  createdAt: string;
}

export interface ReportResponse {
  success: boolean;
  message: string;
  reportId?: string;
}

export class ReportClient {
  /**
   * Submit a report for a prompt
   */
  static async submitReport(
    promptId: string,
    reporterAddress: string,
    reason: ReportReason,
    description?: string
  ): Promise<ReportResponse> {
    try {
      const response = await fetch("/api/prompts/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          promptId,
          reporterAddress,
          reason,
          description,
        }),
      });

      if (!response.ok) {
        throw new Error(`Report failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Report submission error:", error);
      throw error;
    }
  }

  /**
   * Get reports for a specific prompt (admin only)
   */
  static async getPromptReports(promptId: string): Promise<PromptReport[]> {
    try {
      const response = await fetch(`/api/prompts/reports?promptId=${promptId}`, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("adminToken") || ""}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch reports");
      }

      return await response.json();
    } catch (error) {
      console.error("Fetch reports error:", error);
      return [];
    }
  }
}
