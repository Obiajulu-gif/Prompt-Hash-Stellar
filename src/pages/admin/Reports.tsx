import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Clock, EyeOff, GitFork, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportClient, type PromptReport } from "@/lib/reports/reportClient";
import { adminSetPromptSaleStatus } from "@/lib/stellar/promptHashClient";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { useWallet } from "@/hooks/useWallet";
import { fetchProvenanceFlags, type ProvenanceFlag } from "@/lib/prompts/provenance";

const PROVENANCE_FLAG_LABELS: Record<ProvenanceFlag["type"], string> = {
  cross_creator_parent: "Attribution conflict",
  deep_fork_chain: "Suspicious fork chain",
  undeclared_similarity: "Undeclared copy",
  unconfirmed_attribution: "Unconfirmed attribution",
};

const statusStyles: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  investigating: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  resolved: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  dismissed: "bg-slate-500/10 text-slate-300 border-slate-500/20",
};

function statusIcon(status = "pending") {
  if (status === "resolved") return <CheckCircle className="h-4 w-4" />;
  if (status === "dismissed") return <XCircle className="h-4 w-4" />;
  if (status === "investigating") return <AlertCircle className="h-4 w-4" />;
  return <Clock className="h-4 w-4" />;
}

export default function AdminReportsPage() {
  const queryClient = useQueryClient();
  const { address, signTransaction } = useWallet();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const { data: reports = [], isLoading, error } = useQuery({
    queryKey: ["admin-reports"],
    queryFn: () => ReportClient.getAllReports(),
  });

  // Provenance moderation signals (#753): fork chains and attribution conflicts.
  const provenanceFlags = useQuery({
    queryKey: ["admin-provenance-flags"],
    queryFn: fetchProvenanceFlags,
    retry: false,
  });

  const selectedReport = useMemo(
    () => reports.find((report) => report._id === selectedReportId) ?? null,
    [reports, selectedReportId],
  );

  const refreshReports = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-reports"] });

  const updateReport = async (
    report: PromptReport,
    status: "resolved" | "dismissed" | "investigating",
  ) => {
    if (!report._id) return;
    await ReportClient.updateReport(report._id, status, adminNotes);
    setActionMessage(`Report marked ${status}.`);
    await refreshReports();
  };

  const delistPrompt = async (report: PromptReport) => {
    if (!address || !signTransaction) {
      setActionMessage("Connect the platform admin wallet before delisting.");
      return;
    }

    await adminSetPromptSaleStatus(
      browserStellarConfig,
      { signTransaction },
      address,
      report.promptId,
      false,
    );
    if (report._id) {
      await ReportClient.updateReport(report._id, "resolved", adminNotes);
    }
    setActionMessage(`Prompt #${report.promptId} delisted and report resolved.`);
    await refreshReports();
  };

  return (
    <div className="min-h-screen bg-[#020617] p-6 text-white">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-2 text-4xl font-bold">Prompt Reports</h1>
        <p className="mb-8 text-slate-400">
          Review user-submitted reports and hide abusive listings from the marketplace.
        </p>

        {!localStorage.getItem("adminToken") ? (
          <div className="mb-8 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
            Set `adminToken` in local storage or configure `ADMIN_REPORTS_TOKEN` to protect this queue.
          </div>
        ) : null}

        {actionMessage ? (
          <div className="mb-6 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            {actionMessage}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <h2 className="mb-4 text-xl font-semibold">Reports Queue</h2>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : error ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
                Failed to load reports.
              </div>
            ) : reports.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
                <p className="text-slate-400">No reports to review</p>
              </div>
            ) : (
              reports.map((report) => (
                <button
                  key={report._id ?? `${report.promptId}-${report.createdAt}`}
                  type="button"
                  className="w-full rounded-lg border border-white/10 bg-white/5 p-4 text-left transition-all hover:bg-white/[0.08]"
                  onClick={() => {
                    setSelectedReportId(report._id ?? null);
                    setAdminNotes(report.adminNotes ?? "");
                  }}
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Prompt #{report.promptId}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(report.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${
                        statusStyles[report.status ?? "pending"]
                      }`}
                    >
                      {statusIcon(report.status)}
                      {report.status ?? "pending"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">Reason</p>
                  <p className="text-sm text-slate-200">{report.reason}</p>
                  {report.description ? (
                    <p className="mt-3 line-clamp-2 text-xs text-slate-300">
                      {report.description}
                    </p>
                  ) : null}
                </button>
              ))
            )}
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-6 rounded-lg border border-white/10 bg-white/5 p-6">
              <h3 className="mb-4 text-lg font-semibold">Review Actions</h3>

              {selectedReport ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-white/10 bg-slate-950/50 p-3 text-sm">
                    <p className="text-slate-400">Selected prompt</p>
                    <p className="font-mono text-white">#{selectedReport.promptId}</p>
                  </div>

                  <label className="block text-xs font-semibold text-slate-400">
                    Admin notes
                  </label>
                  <textarea
                    value={adminNotes}
                    onChange={(event) => setAdminNotes(event.target.value)}
                    placeholder="Add moderation notes..."
                    className="h-24 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
                  />

                  <div className="space-y-2">
                    <Button
                      className="w-full bg-blue-500 text-white hover:bg-blue-600"
                      onClick={() => void updateReport(selectedReport, "investigating")}
                    >
                      Mark Investigating
                    </Button>
                    <Button
                      className="w-full bg-emerald-500 font-semibold text-slate-950 hover:bg-emerald-600"
                      onClick={() => void updateReport(selectedReport, "resolved")}
                    >
                      Mark Resolved
                    </Button>
                    <Button
                      className="w-full bg-slate-600 font-semibold text-white hover:bg-slate-700"
                      onClick={() => void updateReport(selectedReport, "dismissed")}
                    >
                      Dismiss Report
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full border-red-500/20 text-red-300 hover:bg-red-500/10"
                      onClick={() => void delistPrompt(selectedReport)}
                    >
                      <EyeOff className="h-4 w-4" />
                      Delist Prompt
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Select a report to review actions.</p>
              )}
            </div>
          </div>
        </div>

        <section className="mt-12">
          <h2 className="mb-2 flex items-center gap-2 text-xl font-semibold">
            <GitFork className="h-5 w-5 text-violet-300" />
            Provenance Flags
          </h2>
          <p className="mb-4 text-sm text-slate-400">
            Suspicious fork chains and attribution conflicts in the prompt provenance graph.
            Requires the `provenance:read` scope.
          </p>
          {provenanceFlags.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          ) : provenanceFlags.isError ? (
            <p className="text-sm text-red-300">Failed to load provenance flags.</p>
          ) : (provenanceFlags.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">No provenance flags.</p>
          ) : (
            <ul className="space-y-2">
              {(provenanceFlags.data ?? []).map((flag) => (
                <li
                  key={`${flag.type}-${flag.promptId}-${flag.relatedPromptIds.join(",")}`}
                  className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm"
                >
                  <span className="mr-2 rounded border border-violet-400/20 bg-violet-400/10 px-2 py-0.5 text-xs text-violet-200">
                    {PROVENANCE_FLAG_LABELS[flag.type]}
                  </span>
                  <Link to={`/prompts/${flag.promptId}`} className="font-mono underline underline-offset-4">
                    #{flag.promptId}
                  </Link>
                  {" → "}
                  {flag.relatedPromptIds.map((id) => `#${id}`).join(", ")}
                  <p className="mt-1 text-xs text-slate-400">{flag.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
