/**
 * Admin bulk moderation queue page (#moderation-queue).
 *
 * Features:
 *  - Filter bar: moderationStatus, similarityFlag, creatorWallet, date range
 *  - Paginated prompt table with per-row checkboxes and select-all
 *  - Bulk action toolbar: approve, reject, hide, restore
 *  - Reason + evidence note modal before committing any bulk action
 *  - Applied/skipped result banner (stale-query protection feedback)
 *  - Decision history drawer per prompt with rollback capability
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldX,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

type ModerationStatus = "pending_review" | "approved" | "rejected" | "hidden" | "restored";
type ModerationAction = "approve" | "reject" | "hide" | "restore";
type SimilarityFlag = "clean" | "suspicious" | "highly_similar";

interface ModerationPromptRow {
  _id: string;
  onChainId: string | null;
  title: string;
  moderationStatus: ModerationStatus;
  isActive: boolean;
  similarityFlag: SimilarityFlag;
  integrityStatus: string;
  createdAt: string;
}

interface ModerationDecision {
  _id: string;
  promptId: string;
  action: ModerationAction;
  actorWallet: string;
  reason: string;
  evidenceNote: string | null;
  previousStatus: ModerationStatus;
  newStatus: ModerationStatus;
  rolledBack: boolean;
  rollbackReason: string | null;
  rollbackAt: string | null;
  createdAt: string;
}

interface BulkResult {
  action: string;
  requested: number;
  applied: number;
  skipped: number;
  decisionIds: string[];
}

interface Filters {
  status: ModerationStatus | "";
  similarityFlag: SimilarityFlag | "";
  creatorWallet: string;
  since: string;
  until: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

function adminToken(): string {
  return localStorage.getItem("adminToken") ?? "";
}

function authHeaders(): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` };
}

async function fetchQueue(filters: Filters, page: number) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.similarityFlag) params.set("similarityFlag", filters.similarityFlag);
  if (filters.creatorWallet) params.set("creatorWallet", filters.creatorWallet);
  if (filters.since) params.set("since", filters.since);
  if (filters.until) params.set("until", filters.until);
  params.set("page", String(page));
  params.set("limit", "20");
  const res = await fetch(`/api/moderation/queue?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Queue fetch failed: ${res.status}`);
  return res.json() as Promise<{ prompts: ModerationPromptRow[]; page: number; total: number; totalPages: number }>;
}

async function fetchDecisions(promptId: string) {
  const res = await fetch(`/api/moderation/decisions?promptId=${promptId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Decisions fetch failed: ${res.status}`);
  return res.json() as Promise<ModerationDecision[]>;
}

async function applyBulkAction(
  action: ModerationAction,
  promptIds: string[],
  reason: string,
  evidenceNote: string,
): Promise<BulkResult> {
  const res = await fetch("/api/moderation/bulk", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ action, promptIds, reason, evidenceNote: evidenceNote || undefined }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Bulk action failed: ${res.status}`);
  }
  return res.json() as Promise<BulkResult>;
}

async function rollbackDecision(id: string, reason: string): Promise<void> {
  const res = await fetch(`/api/moderation/decisions/${id}/rollback`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Rollback failed: ${res.status}`);
  }
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<ModerationStatus, string> = {
  pending_review: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  approved:       "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  rejected:       "bg-red-500/10 text-red-300 border-red-500/20",
  hidden:         "bg-slate-500/10 text-slate-300 border-slate-500/20",
  restored:       "bg-blue-500/10 text-blue-300 border-blue-500/20",
};

function StatusBadge({ status }: { status: ModerationStatus }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

const SIM_STYLES: Record<SimilarityFlag, string> = {
  clean:          "text-emerald-400",
  suspicious:     "text-amber-400",
  highly_similar: "text-red-400",
};

// ── Confirm modal ─────────────────────────────────────────────────────────────

function ConfirmModal({
  action,
  count,
  onConfirm,
  onCancel,
}: {
  action: ModerationAction;
  count: number;
  onConfirm: (reason: string, evidence: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");

  const ACTION_LABELS: Record<ModerationAction, string> = {
    approve: "Approve",
    reject:  "Reject",
    hide:    "Hide",
    restore: "Restore",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="modal-title" className="text-base font-semibold text-white">
            {ACTION_LABELS[action]} {count} prompt{count !== 1 ? "s" : ""}
          </h2>
          <button onClick={onCancel} aria-label="Cancel" className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mb-1 block text-xs font-semibold text-slate-400">
          Reason <span className="text-red-400">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Provide a clear moderation reason…"
          className="mb-3 h-20 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-white/20"
        />

        <label className="mb-1 block text-xs font-semibold text-slate-400">
          Evidence note <span className="text-slate-500">(optional)</span>
        </label>
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="Supporting evidence, links, or context…"
          className="mb-4 h-16 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-white/20"
        />

        <div className="flex gap-2">
          <Button
            className="flex-1 bg-white text-slate-900 hover:bg-slate-200 disabled:opacity-50"
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim(), evidence.trim())}
          >
            Confirm {ACTION_LABELS[action]}
          </Button>
          <Button
            variant="outline"
            className="border-white/10 text-slate-300 hover:bg-white/5"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Decision history drawer ───────────────────────────────────────────────────

function DecisionDrawer({
  promptId,
  promptTitle,
  onClose,
  onRollback,
}: {
  promptId: string;
  promptTitle: string;
  onClose: () => void;
  onRollback: () => void;
}) {
  const { data: decisions = [], isLoading } = useQuery({
    queryKey: ["moderation-decisions", promptId],
    queryFn: () => fetchDecisions(promptId),
  });

  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const [rollbackReason, setRollbackReason] = useState("");
  const [rolling, setRolling] = useState(false);

  const handleRollback = async () => {
    if (!rollbackId || !rollbackReason.trim()) return;
    setRolling(true);
    try {
      await rollbackDecision(rollbackId, rollbackReason.trim());
      setRollbackId(null);
      setRollbackReason("");
      onRollback();
    } finally {
      setRolling(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-96 flex-col border-l border-white/10 bg-slate-950 shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">Decision history</p>
          <p className="truncate text-sm font-semibold text-white">{promptTitle}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="ml-3 shrink-0 text-slate-400 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : decisions.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">No decisions recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {decisions.map((d) => (
              <li key={d._id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    {d.action}
                  </span>
                  {d.rolledBack && (
                    <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                      rolled back
                    </span>
                  )}
                </div>
                <p className="mb-0.5 text-xs text-slate-300">{d.reason}</p>
                {d.evidenceNote && (
                  <p className="mb-0.5 text-[10px] italic text-slate-400">{d.evidenceNote}</p>
                )}
                <p className="text-[10px] text-slate-500">
                  {new Date(d.createdAt).toLocaleString()} ·{" "}
                  <span className="font-mono">{d.actorWallet.slice(0, 12)}…</span>
                </p>

                {!d.rolledBack && (
                  <div className="mt-2">
                    {rollbackId === d._id ? (
                      <div className="space-y-1">
                        <textarea
                          value={rollbackReason}
                          onChange={(e) => setRollbackReason(e.target.value)}
                          placeholder="Rollback reason…"
                          className="h-14 w-full resize-none rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-slate-500"
                        />
                        <div className="flex gap-1">
                          <Button
                            className="h-6 flex-1 bg-amber-500 px-2 text-xs text-slate-900 hover:bg-amber-600 disabled:opacity-50"
                            disabled={!rollbackReason.trim() || rolling}
                            onClick={() => void handleRollback()}
                          >
                            {rolling ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm rollback"}
                          </Button>
                          <Button
                            variant="outline"
                            className="h-6 border-white/10 px-2 text-xs text-slate-400"
                            onClick={() => { setRollbackId(null); setRollbackReason(""); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRollbackId(d._id)}
                        className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-amber-300"
                      >
                        <RotateCcw className="h-3 w-3" /> Rollback this decision
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const EMPTY_FILTERS: Filters = {
  status: "",
  similarityFlag: "",
  creatorWallet: "",
  since: "",
  until: "",
};

export default function ModerationQueuePage() {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<ModerationAction | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [drawerPrompt, setDrawerPrompt] = useState<{ id: string; title: string } | null>(null);

  const queryKey = ["moderation-queue", appliedFilters, page];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => fetchQueue(appliedFilters, page),
  });

  const prompts = data?.prompts ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  // Reset selection when the query result changes
  useEffect(() => { setSelected(new Set()); }, [queryKey.join(",")]);

  const allPageSelected = useMemo(
    () => prompts.length > 0 && prompts.every((p) => selected.has(p._id)),
    [prompts, selected],
  );

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) prompts.forEach((p) => next.delete(p._id));
      else prompts.forEach((p) => next.add(p._id));
      return next;
    });
  }, [allPageSelected, prompts]);

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleApplyFilters = () => {
    setAppliedFilters(filters);
    setPage(1);
    setSelected(new Set());
  };

  const handleClearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
    setSelected(new Set());
  };

  const handleBulkConfirm = async (reason: string, evidence: string) => {
    if (!pendingAction || selected.size === 0) return;
    setSubmitting(true);
    setBulkResult(null);
    setBulkError(null);
    try {
      const result = await applyBulkAction(pendingAction, [...selected], reason, evidence);
      setBulkResult(result);
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["moderation-queue"] });
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Bulk action failed.");
    } finally {
      setSubmitting(false);
      setPendingAction(null);
    }
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["moderation-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["moderation-decisions"] });
  };

  return (
    <div className="min-h-screen bg-[#020617] p-6 text-white">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">Moderation Queue</h1>
            <p className="mt-1 text-sm text-slate-400">
              Review, approve, reject, hide, or restore prompts in bulk. Every action is
              recorded in the audit log.
            </p>
          </div>
          <Button
            variant="outline"
            className="border-white/10 text-slate-300 hover:bg-white/5"
            onClick={refresh}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Filter bar */}
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as ModerationStatus | "" }))}
              className="rounded border border-white/10 bg-slate-900 px-3 py-1.5 text-sm text-white"
            >
              <option value="">All statuses</option>
              <option value="pending_review">Pending review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="hidden">Hidden</option>
              <option value="restored">Restored</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Similarity</label>
            <select
              value={filters.similarityFlag}
              onChange={(e) => setFilters((f) => ({ ...f, similarityFlag: e.target.value as SimilarityFlag | "" }))}
              className="rounded border border-white/10 bg-slate-900 px-3 py-1.5 text-sm text-white"
            >
              <option value="">Any</option>
              <option value="clean">Clean</option>
              <option value="suspicious">Suspicious</option>
              <option value="highly_similar">Highly similar</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Creator wallet</label>
            <input
              type="text"
              placeholder="G…"
              value={filters.creatorWallet}
              onChange={(e) => setFilters((f) => ({ ...f, creatorWallet: e.target.value }))}
              className="rounded border border-white/10 bg-slate-900 px-3 py-1.5 text-sm text-white placeholder:text-slate-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Since</label>
            <input
              type="date"
              value={filters.since}
              onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value }))}
              className="rounded border border-white/10 bg-slate-900 px-3 py-1.5 text-sm text-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Until</label>
            <input
              type="date"
              value={filters.until}
              onChange={(e) => setFilters((f) => ({ ...f, until: e.target.value }))}
              className="rounded border border-white/10 bg-slate-900 px-3 py-1.5 text-sm text-white"
            />
          </div>

          <Button
            className="bg-white text-slate-900 hover:bg-slate-200"
            onClick={handleApplyFilters}
          >
            Apply filters
          </Button>
          <button
            onClick={handleClearFilters}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Clear
          </button>
        </div>

        {/* Bulk result / error banners */}
        {bulkResult && (
          <div className="mb-4 flex items-start justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            <span>
              <strong>{bulkResult.action}</strong> applied to{" "}
              <strong>{bulkResult.applied}</strong> prompt{bulkResult.applied !== 1 ? "s" : ""}
              {bulkResult.skipped > 0 ? ` (${bulkResult.skipped} skipped — state had changed)` : ""}.
            </span>
            <button onClick={() => setBulkResult(null)} aria-label="Dismiss" className="ml-4 text-emerald-300 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {bulkError && (
          <div className="mb-4 flex items-start justify-between rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            {bulkError}
            <button onClick={() => setBulkError(null)} aria-label="Dismiss" className="ml-4 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Bulk action toolbar */}
        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-900 px-4 py-2">
            <span className="text-sm text-slate-300">
              <strong>{selected.size}</strong> selected
            </span>
            <div className="ml-2 flex flex-wrap gap-2">
              <Button
                className="h-7 bg-emerald-600 px-3 text-xs hover:bg-emerald-700"
                disabled={submitting}
                onClick={() => setPendingAction("approve")}
              >
                <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Approve
              </Button>
              <Button
                className="h-7 bg-red-600 px-3 text-xs hover:bg-red-700"
                disabled={submitting}
                onClick={() => setPendingAction("reject")}
              >
                <ShieldX className="mr-1 h-3.5 w-3.5" /> Reject
              </Button>
              <Button
                className="h-7 bg-slate-600 px-3 text-xs hover:bg-slate-700"
                disabled={submitting}
                onClick={() => setPendingAction("hide")}
              >
                <EyeOff className="mr-1 h-3.5 w-3.5" /> Hide
              </Button>
              <Button
                className="h-7 bg-blue-600 px-3 text-xs hover:bg-blue-700"
                disabled={submitting}
                onClick={() => setPendingAction("restore")}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Restore
              </Button>
            </div>
            <button
              className="ml-auto text-xs text-slate-500 hover:text-slate-300"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-white/10">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 p-6 text-sm text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load moderation queue.
            </div>
          ) : prompts.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
              <p className="text-slate-400">No prompts match the current filters.</p>
            </div>
          ) : (
            <table className="w-full table-fixed text-sm" aria-label="Moderation queue">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-left text-xs text-slate-400">
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allPageSelected}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-3 py-2">Prompt</th>
                  <th className="w-32 px-3 py-2">Status</th>
                  <th className="w-28 px-3 py-2">Similarity</th>
                  <th className="w-28 px-3 py-2">Created</th>
                  <th className="w-20 px-3 py-2">History</th>
                </tr>
              </thead>
              <tbody>
                {prompts.map((p) => (
                  <tr
                    key={p._id}
                    className={`border-b border-white/5 last:border-0 transition-colors ${
                      selected.has(p._id) ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Select "${p.title}"`}
                        checked={selected.has(p._id)}
                        onChange={() => toggleRow(p._id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="truncate font-medium text-white">{p.title || "(untitled)"}</p>
                      <p className="font-mono text-[10px] text-slate-500">{p.onChainId ?? p._id}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={p.moderationStatus} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs ${SIM_STYLES[p.similarityFlag]}`}>
                        {p.similarityFlag.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => setDrawerPrompt({ id: p._id, title: p.title || p._id })}
                        className="text-xs text-slate-400 underline-offset-2 hover:text-white hover:underline"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!isLoading && total > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
            <span>{total} total prompt{total !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
                className="rounded p-1 hover:bg-white/10 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
                className="rounded p-1 hover:bg-white/10 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals and drawers */}
      {pendingAction && (
        <ConfirmModal
          action={pendingAction}
          count={selected.size}
          onConfirm={(r, e) => void handleBulkConfirm(r, e)}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {drawerPrompt && (
        <DecisionDrawer
          promptId={drawerPrompt.id}
          promptTitle={drawerPrompt.title}
          onClose={() => setDrawerPrompt(null)}
          onRollback={() => {
            void queryClient.invalidateQueries({ queryKey: ["moderation-decisions", drawerPrompt.id] });
            void queryClient.invalidateQueries({ queryKey: ["moderation-queue"] });
          }}
        />
      )}
    </div>
  );
}
