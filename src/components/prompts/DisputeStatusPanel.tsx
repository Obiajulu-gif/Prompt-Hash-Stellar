import { AlertTriangle, CheckCircle2, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DISPUTE_STATUS_LABELS,
  type BuyerDisputeView,
  type DisputeStatus,
} from "@/lib/prompts/disputes";

const STATUS_COPY: Partial<Record<DisputeStatus, string>> = {
  failed:
    "Your payment is confirmed, but the prompt could not be delivered. The purchase is held for review — you can try unlocking again or request a refund.",
  retrying:
    "A maintainer has re-armed delivery. Unlock the prompt again; a successful unlock closes this dispute automatically.",
  refund_requested:
    "Your refund request is waiting for maintainer review. Approved refunds are paid back from escrow on-chain.",
  refunded: "Your refund was approved.",
  rejected: "Your refund request was declined.",
  resolved: "A maintainer closed this dispute.",
};

const OPEN_TONE = "border-amber-300/20 bg-amber-300/[0.05] text-amber-100";
const CLOSED_TONE = "border-slate-500/20 bg-slate-500/[0.05] text-slate-200";

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export interface DisputeStatusPanelProps {
  dispute: BuyerDisputeView;
  onRequestRefund?: () => void;
}

/**
 * Buyer view of a disputed purchase (#755): where the dispute stands, what
 * the buyer can do next, and the maintainer's resolution notes. Shows no
 * wallet or payment metadata.
 */
export function DisputeStatusPanel({ dispute, onRequestRefund }: DisputeStatusPanelProps) {
  if (dispute.status === "pending" || dispute.status === "delivered") {
    return null;
  }

  const Icon = dispute.isOpen ? AlertTriangle : CheckCircle2;
  const recentTimeline = dispute.timeline.slice(-4).reverse();

  return (
    <div
      data-testid="dispute-status-panel"
      data-status={dispute.status}
      className={`rounded-xl border p-4 space-y-3 ${dispute.isOpen ? OPEN_TONE : CLOSED_TONE}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
          <Icon className="h-4 w-4" />
          {DISPUTE_STATUS_LABELS[dispute.status]}
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
          Purchase dispute
        </span>
      </div>

      {STATUS_COPY[dispute.status] && (
        <p className="text-xs leading-relaxed text-slate-300">{STATUS_COPY[dispute.status]}</p>
      )}

      {dispute.resolutionNotes && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-200">
          <span className="font-semibold">Maintainer notes: </span>
          {dispute.resolutionNotes}
        </p>
      )}

      <p className="text-[11px] text-slate-400">
        Failed unlock attempts: <span className="text-slate-200">{dispute.unlockAttempts}</span>
        {dispute.retryCount > 0 && (
          <>
            {" "}
            · Retries scheduled: <span className="text-slate-200">{dispute.retryCount}</span>
          </>
        )}
      </p>

      {recentTimeline.length > 0 && (
        <ol className="space-y-1 border-l border-white/10 pl-3">
          {recentTimeline.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex items-center gap-2 text-[11px] text-slate-400">
              <Clock className="h-3 w-3 shrink-0" />
              <span className="text-slate-200">{DISPUTE_STATUS_LABELS[entry.status] ?? entry.status}</span>
              <span>{formatWhen(entry.at)}</span>
            </li>
          ))}
        </ol>
      )}

      {dispute.refundEligible && dispute.status !== "refund_requested" && onRequestRefund && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRequestRefund}
          className="h-8 border border-amber-400/30 text-amber-200 hover:bg-amber-400/10 text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Request refund
        </Button>
      )}
    </div>
  );
}
