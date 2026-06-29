import type { ReportReason } from "../../src/lib/reports/reportClient";

interface StoredPromptReport {
  _id: string;
  promptId: string;
  reporterAddress: string;
  reason: ReportReason;
  description?: string;
  status: "pending" | "investigating" | "resolved" | "dismissed";
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}

const reports = new Map<string, StoredPromptReport[]>();

function requireAdmin(req: any): boolean {
  const expected = process.env.ADMIN_REPORTS_TOKEN;
  if (!expected) return true;
  return req.headers.authorization === `Bearer ${expected}`;
}

function allReports(): StoredPromptReport[] {
  return Array.from(reports.values())
    .flat()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export default async function handler(req: any, res: any) {
  if (req.method === "POST") {
    const { promptId, reporterAddress, reason, description } = req.body ?? {};

    if (!promptId || !reporterAddress || !reason) {
      res.status(400).json({
        error: "Missing required fields: promptId, reporterAddress, reason",
      });
      return;
    }

    const now = new Date().toISOString();
    const report: StoredPromptReport = {
      _id: `report_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      promptId: String(promptId),
      reporterAddress: String(reporterAddress),
      reason,
      description: description ? String(description).trim() : undefined,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    const promptReports = reports.get(report.promptId) ?? [];
    promptReports.push(report);
    reports.set(report.promptId, promptReports);

    res.status(201).json({
      success: true,
      message: "Report submitted successfully",
      reportId: report._id,
    });
    return;
  }

  if (req.method === "GET") {
    if (!requireAdmin(req)) {
      res.status(401).json({ error: "Admin authentication required" });
      return;
    }

    const promptId = req.query?.promptId ? String(req.query.promptId) : "";
    res.status(200).json(promptId ? reports.get(promptId) ?? [] : allReports());
    return;
  }

  if (req.method === "PATCH") {
    if (!requireAdmin(req)) {
      res.status(401).json({ error: "Admin authentication required" });
      return;
    }

    const { reportId, status, adminNotes } = req.body ?? {};
    const report = allReports().find((item) => item._id === reportId);
    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    report.status = status ?? report.status;
    report.adminNotes = adminNotes ?? report.adminNotes;
    report.updatedAt = new Date().toISOString();
    res.status(200).json({ success: true, report });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
