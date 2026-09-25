import type { ReportReason, ReportEvidence } from "../../src/lib/reports/reportClient";

export type ReportStatus = "pending" | "investigating" | "resolved" | "dismissed";

interface StoredPromptReport {
  _id: string;
  promptId: string;
  reporterAddress: string;
  reason: ReportReason;
  description?: string;
  evidence: ReportEvidence[];
  status: ReportStatus;
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}

const VALID_REASONS: ReportReason[] = [
  "quality-issue",
  "misleading-content",
  "plagiarism",
  "harmful-content",
  "copyright",
  "other",
];

const STATUS_ORDER: Record<ReportStatus, number> = {
  pending: 0,
  investigating: 1,
  resolved: 2,
  dismissed: 2,
};

const VALID_EVIDENCE_KINDS = ["image", "pdf", "link", "text"];

function isReportStatus(value: unknown): value is ReportStatus {
  return (
    typeof value === "string" &&
    (value === "pending" ||
      value === "investigating" ||
      value === "resolved" ||
      value === "dismissed")
  );
}

function normalizeEvidence(raw: unknown): ReportEvidence[] {
  if (!Array.isArray(raw)) return [];
  const evidence: ReportEvidence[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const url = (item as { url?: unknown }).url;
    const kind = (item as { kind?: unknown }).kind;
    if (typeof url !== "string" || !url.trim()) continue;
    evidence.push({
      url: url.trim(),
      kind:
        typeof kind === "string" && VALID_EVIDENCE_KINDS.includes(kind)
          ? (kind as ReportEvidence["kind"])
          : "link",
      addedBy: String(
        (item as { addedBy?: unknown }).addedBy ?? "reporter",
      ),
    });
  }
  return evidence.slice(0, 10);
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
    const { promptId, reporterAddress, reason, description, evidence } =
      req.body ?? {};

    if (!promptId || !reporterAddress || !reason) {
      res.status(400).json({
        error: "Missing required fields: promptId, reporterAddress, reason",
      });
      return;
    }

    if (typeof reason !== "string" || !VALID_REASONS.includes(reason as ReportReason)) {
      res.status(400).json({
        error: `Invalid reason. Must be one of: ${VALID_REASONS.join(", ")}`,
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
      evidence: normalizeEvidence(evidence),
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
      evidenceCount: report.evidence.length,
    });
    return;
  }

  if (req.method === "GET") {
    if (!requireAdmin(req)) {
      res.status(401).json({ error: "Admin authentication required" });
      return;
    }

    const promptId = req.query?.promptId ? String(req.query.promptId) : "";
    const status = req.query?.status ? String(req.query.status).trim() : "";
    const filter = isReportStatus(status) ? status : "";

    if (promptId) {
      const rows = reports.get(promptId) ?? [];
      res.status(200).json(filter ? rows.filter((r) => r.status === filter) : rows);
      return;
    }
    const rows = allReports();
    res.status(200).json(filter ? rows.filter((r) => r.status === filter) : rows);
    return;
  }

  if (req.method === "PATCH") {
    if (!requireAdmin(req)) {
      res.status(401).json({ error: "Admin authentication required" });
      return;
    }

    const { reportId, status, adminNotes, evidence } = req.body ?? {};
    const report = allReports().find((item) => item._id === reportId);
    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    // Enforce a forward-only triage lifecycle: pending → investigating →
    // resolved|dismissed. Maintainers cannot regress or re-open a closed report
    // (#714). This keeps the moderation audit trail unambiguous.
    let nextStatus: ReportStatus | undefined;
    if (status !== undefined && status !== null) {
      if (!isReportStatus(status)) {
        res.status(400).json({
          error: "Invalid status. Expected pending, investigating, resolved, or dismissed.",
        });
        return;
      }
      if (STATUS_ORDER[status] < STATUS_ORDER[report.status]) {
        res.status(409).json({
          error: `Illegal status transition ${report.status} → ${status}. Triage is forward-only (#714).`,
          currentStatus: report.status,
        });
        return;
      }
      nextStatus = status;
    }

    if (nextStatus) report.status = nextStatus;
    if (adminNotes !== undefined && adminNotes !== null) {
      report.adminNotes = String(adminNotes).trim();
    }
    if (evidence !== undefined && evidence !== null) {
      const added = normalizeEvidence(evidence);
      if (added.length) {
        report.evidence = report.evidence.concat(added);
      }
    }
    report.updatedAt = new Date().toISOString();
    res.status(200).json({ success: true, report });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
