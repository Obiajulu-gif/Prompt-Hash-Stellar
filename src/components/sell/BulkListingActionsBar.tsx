import { useState } from "react";
import { CheckCircle2, Loader2, PauseCircle, PlayCircle, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BulkListingAction, BulkListingResult } from "@/lib/prompts/bulkListingActions";
import { IRREVERSIBLE_BULK_ACTIONS } from "@/lib/prompts/bulkListingActions";

interface BulkListingActionsBarProps {
  selectedCount: number;
  isRunning: boolean;
  /** Set once an action has run; cleared when the selection changes. */
  results: BulkListingResult[] | null;
  onRunAction: (action: BulkListingAction) => void;
  onClearSelection: () => void;
  onDismissResults: () => void;
}

const ACTIONS: Array<{
  action: BulkListingAction;
  label: string;
  icon: typeof PlayCircle;
  confirmCopy: string;
}> = [
  {
    action: "activate",
    label: "Activate",
    icon: PlayCircle,
    confirmCopy: "listed for sale again",
  },
  {
    action: "pause",
    label: "Pause",
    icon: PauseCircle,
    confirmCopy: "hidden from the marketplace until reactivated",
  },
  {
    action: "retire",
    label: "Retire",
    icon: Trash2,
    confirmCopy: "taken off sale and archived out of your active listings",
  },
];

/**
 * Multi-select bulk action toolbar for creator listings (issue #500).
 * Renders inline when one or more listings are selected; irreversible-style
 * actions (retire) require an explicit confirm step before running.
 */
export function BulkListingActionsBar({
  selectedCount,
  isRunning,
  results,
  onRunAction,
  onClearSelection,
  onDismissResults,
}: BulkListingActionsBarProps) {
  const [pendingConfirm, setPendingConfirm] = useState<BulkListingAction | null>(null);

  if (selectedCount === 0 && !results) {
    return null;
  }

  const handleActionClick = (action: BulkListingAction) => {
    if (IRREVERSIBLE_BULK_ACTIONS.has(action)) {
      setPendingConfirm(action);
      return;
    }
    onRunAction(action);
  };

  const successCount = results?.filter((r) => r.success).length ?? 0;
  const failureCount = results ? results.length - successCount : 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 space-y-3">
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-slate-200">
            {selectedCount} listing{selectedCount === 1 ? "" : "s"} selected
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {ACTIONS.map(({ action, label, icon: Icon }) => (
              <Button
                key={action}
                size="sm"
                variant="outline"
                className="gap-1.5 border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                onClick={() => handleActionClick(action)}
                disabled={isRunning}
              >
                {isRunning && pendingConfirm === null ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
                {label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="border-white/10 bg-transparent text-slate-400 hover:bg-white/10"
              onClick={onClearSelection}
              disabled={isRunning}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {pendingConfirm && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p>
            Retire {selectedCount} listing{selectedCount === 1 ? "" : "s"}? Retired
            listings are {ACTIONS.find((a) => a.action === pendingConfirm)?.confirmCopy}.
            You can restore an archived listing later from the Archived section.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="bg-amber-400 text-slate-950 hover:bg-amber-300"
              onClick={() => {
                onRunAction(pendingConfirm);
                setPendingConfirm(null);
              }}
            >
              Confirm retire
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-white/10 bg-transparent text-slate-200 hover:bg-white/10"
              onClick={() => setPendingConfirm(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {results && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
          <div className="flex items-center justify-between">
            <p className="text-slate-300">
              {successCount} succeeded
              {failureCount > 0 ? `, ${failureCount} failed` : ""}
            </p>
            <button
              onClick={onDismissResults}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Dismiss
            </button>
          </div>
          <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {results.map((result) => (
              <li
                key={result.promptId}
                className="flex items-start gap-2 text-xs text-slate-300"
              >
                {result.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-400" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-400" />
                )}
                <span className="min-w-0 truncate">
                  {result.title}
                  {!result.success && result.error ? ` — ${result.error}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
