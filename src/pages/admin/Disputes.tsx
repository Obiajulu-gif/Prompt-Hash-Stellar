import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  approveDisputeRefund,
  closeDispute,
  DISPUTE_STATUS_LABELS,
  listDisputes,
  rejectDisputeRefund,
  retryDisputeUnlock,
  type DisputeStatus,
  type MaintainerDisputeView,
} from "@/lib/prompts/disputes";

const FILTERS: { label: string; statuses: DisputeStatus[] }[] = [
  { label: "Open", statuses: ["failed", "retrying", "refund_requested"] },
  { label: "Closed", statuses: ["refunded", "rejected", "resolved", "delivered"] },
];

function shortWallet(wallet: string): string {
  return wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

/**
 * Maintainer view for disputed purchases (#755): payment succeeded but the
 * unlock failed. Maintainers can re-arm the unlock, approve or reject a
 * refund, or close the dispute with notes the buyer will see.
 */
export default function AdminDisputesPage() {
  const queryClient = useQueryClient();
  const [filterIndex, setFilterIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [resolutionTxHash, setResolutionTxHash] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const statuses = FILTERS[filterIndex].statuses;
  const { data: disputes = [], isLoading, error } = useQuery({
    queryKey: ["admin-disputes", statuses],
    queryFn: () => listDisputes(statuses),
  });

  const selected = useMemo(
    () => disputes.find((dispute) => dispute.id === selectedId) ?? null,
    [disputes, selectedId],
  );

  const action = useMutation<
    MaintainerDisputeView,
    Error,
    { run: (dispute: MaintainerDisputeView) => Promise<MaintainerDisputeView>; done: string }
  >({
    mutationFn: ({ run }) => run(selected as MaintainerDisputeView),
    onSuccess: async (_updated, { done }) => {
      setMessage(done);
      setNotes("");
      setResolutionTxHash("");
      await queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
    },
    onError: (err) => setMessage(err.message),
  });

  const canRetry = selected && ["failed", "refund_requested"].includes(selected.status);
  const canRefund = selected && ["failed", "retrying", "refund_requested"].includes(selected.status);
  const canReject = selected?.status === "refund_requested";
  const canClose =
    selected && ["failed", "retrying", "refund_requested", "rejected"].includes(selected.status);

  return (
    <div className="min-h-screen bg-[#020617] p-6 text-white">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-2 text-4xl font-bold">Disputed Purchases</h1>
        <p className="mb-8 text-slate-400">
          Purchases whose payment succeeded but whose unlock failed. Every action is
          recorded in the audit trail.
        </p>

        {!localStorage.getItem("adminToken") ? (
          <div className="mb-8 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
            Set `adminToken` in local storage with the `fulfillment:read` and
            `fulfillment:resolve` scopes to manage disputes.
          </div>
        ) : null}

        {message ? (
          <div className="mb-6 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            {message}
          </div>
        ) : null}

        <div className="mb-6 flex gap-2">
          {FILTERS.map((filter, index) => (
            <Button
              key={filter.label}
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterIndex(index);
                setSelectedId(null);
              }}
              className={`border border-white/10 ${
                index === filterIndex ? "bg-white/10 text-white" : "text-slate-400"
              }`}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : error ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
                Failed to load disputes.
              </div>
            ) : disputes.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
                <p className="text-slate-400">No disputes in this view</p>
              </div>
            ) : (
              disputes.map((dispute) => (
                <button
                  key={dispute.id}
                  type="button"
                  className={`w-full rounded-lg border p-4 text-left transition-all hover:bg-white/[0.08] ${
                    dispute.id === selectedId ? "border-cyan-300/40 bg-white/[0.08]" : "border-white/10 bg-white/5"
                  }`}
                  onClick={() => {
                    setSelectedId(dispute.id);
                    setNotes("");
                    setMessage(null);
                  }}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Prompt #{dispute.promptId}</p>
                      <p className="font-mono text-xs text-slate-500">
                        Buyer {shortWallet(dispute.buyerWallet)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {dispute.stale && (
                        <span className="flex items-center gap-1 rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-300">
                          <Clock className="h-3.5 w-3.5" />
                          Stale
                        </span>
                      )}
                      <span className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                        {DISPUTE_STATUS_LABELS[dispute.status]}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    Failure: {dispute.failureReason ?? "—"} · Attempts: {dispute.unlockAttempts} ·
                    Retries: {dispute.retryCount}
                  </p>
                  {dispute.refundReason ? (
                    <p className="mt-2 line-clamp-2 text-xs text-slate-300">
                      Refund reason: {dispute.refundReason}
                    </p>
                  ) : null}
                </button>
              ))
            )}
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-6 rounded-lg border border-white/10 bg-white/5 p-6">
              <h3 className="mb-4 text-lg font-semibold">Resolution</h3>

              {selected ? (
                <div className="space-y-4">
                  <ol className="space-y-2 border-l border-white/10 pl-3 text-xs text-slate-400">
                    {selected.timeline.map((entry, index) => (
                      <li key={`${entry.at}-${index}`}>
                        <span className="text-slate-200">{DISPUTE_STATUS_LABELS[entry.status] ?? entry.status}</span>
                        {" · "}
                        {entry.actor ?? "system"} · {new Date(entry.at).toLocaleString()}
                        {entry.note ? <p className="text-slate-500">{entry.note}</p> : null}
                      </li>
                    ))}
                  </ol>

                  <label className="block text-xs font-semibold text-slate-400">
                    Resolution notes (shown to the buyer)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Explain the outcome..."
                    className="h-24 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
                  />
                  <label className="block text-xs font-semibold text-slate-400">
                    On-chain refund transaction (optional)
                  </label>
                  <input
                    value={resolutionTxHash}
                    onChange={(event) => setResolutionTxHash(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white"
                  />

                  <div className="space-y-2">
                    <Button
                      className="w-full bg-blue-500 text-white hover:bg-blue-600"
                      disabled={!canRetry || action.isPending}
                      onClick={() =>
                        action.mutate({
                          run: (d) => retryDisputeUnlock(d, notes || undefined),
                          done: "Unlock retry scheduled.",
                        })
                      }
                    >
                      Retry Unlock
                    </Button>
                    <Button
                      className="w-full bg-emerald-500 font-semibold text-slate-950 hover:bg-emerald-600"
                      disabled={!canRefund || action.isPending}
                      onClick={() =>
                        action.mutate({
                          run: (d) =>
                            approveDisputeRefund(d, notes || undefined, resolutionTxHash || undefined),
                          done: "Refund approved.",
                        })
                      }
                    >
                      Approve Refund
                    </Button>
                    <Button
                      className="w-full bg-slate-600 font-semibold text-white hover:bg-slate-700"
                      disabled={!canReject || action.isPending}
                      onClick={() =>
                        action.mutate({
                          run: (d) => rejectDisputeRefund(d, notes || undefined),
                          done: "Refund rejected.",
                        })
                      }
                    >
                      Reject Refund
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full border-white/20 text-white hover:bg-white/10"
                      disabled={!canClose || notes.trim().length < 3 || action.isPending}
                      onClick={() =>
                        action.mutate({
                          run: (d) => closeDispute(d, notes.trim()),
                          done: "Dispute closed as resolved.",
                        })
                      }
                    >
                      Close as Resolved
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Select a dispute to review actions.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
