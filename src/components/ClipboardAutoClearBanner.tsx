import { Clock, ShieldAlert, X } from "lucide-react";

interface ClipboardAutoClearBannerProps {
  remaining: number;
  enabled: boolean;
  onToggle: () => void;
  onCancel: () => void;
}

export function ClipboardAutoClearBanner({
  remaining,
  enabled,
  onToggle,
  onCancel,
}: ClipboardAutoClearBannerProps) {
  if (!enabled && remaining === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100 flex items-center gap-2 flex-wrap">
      {remaining > 0 ? (
        <>
          <Clock className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
          <span>
            Clipboard clears in{" "}
            <span className="font-mono font-semibold text-cyan-200">
              {remaining}s
            </span>
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-cyan-200 hover:bg-white/10 transition-colors"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
        </>
      ) : (
        <>
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
          <span>Auto-clear clipboard after copy</span>
          <button
            type="button"
            onClick={onToggle}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-cyan-200 hover:bg-white/10 transition-colors"
          >
            {enabled ? "Disable" : "Enable"}
          </button>
        </>
      )}
    </div>
  );
}
