import { useMemo } from "react";
import { AlertCircle, CheckCircle2, ShieldAlert, Lock } from "lucide-react";
import {
  estimateEncryptedPayloadSize,
  MAX_ENCRYPTED_PROMPT_LIMIT,
} from "@/lib/crypto/payloadEstimator";

interface EncryptedPayloadSizeEstimatorProps {
  fullPromptText: string;
  limit?: number;
  className?: string;
}

export function EncryptedPayloadSizeEstimator({
  fullPromptText,
  limit = MAX_ENCRYPTED_PROMPT_LIMIT,
  className = "",
}: EncryptedPayloadSizeEstimatorProps) {
  const estimate = useMemo(
    () => estimateEncryptedPayloadSize(fullPromptText, limit),
    [fullPromptText, limit]
  );

  const getProgressColor = () => {
    if (estimate.isOverLimit) return "bg-red-500 text-red-400 border-red-500/40";
    if (estimate.percentageOfLimit > 85) return "bg-amber-500 text-amber-400 border-amber-500/40";
    return "bg-emerald-500 text-emerald-400 border-emerald-500/40";
  };

  return (
    <div className={`p-4 rounded-2xl border bg-slate-950/60 space-y-3 ${estimate.isOverLimit ? "border-red-500/50 bg-red-950/10" : "border-slate-800"} ${className}`}>
      {/* Title & Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-emerald-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Encrypted Payload Size Estimator
          </h4>
        </div>
        <span
          className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
            estimate.isOverLimit
              ? "bg-red-500/10 text-red-400 border-red-500/30"
              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
          }`}
        >
          {estimate.totalPayloadBytes} / {estimate.limitBytes} B ({estimate.percentageOfLimit.toFixed(0)}%)
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-white/5 relative">
        <div
          className={`h-full transition-all duration-300 rounded-full ${getProgressColor().split(" ")[0]}`}
          style={{ width: `${Math.min(estimate.percentageOfLimit, 100)}%` }}
        />
      </div>

      {/* Breakdown details */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-slate-400 pt-1">
        <div>Plaintext: <span className="text-slate-200">{estimate.plaintextSizeBytes} B</span></div>
        <div>Ciphertext (b64): <span className="text-slate-200">{estimate.ciphertextBase64Length} B</span></div>
        <div>IV (b64): <span className="text-slate-200">{estimate.ivBase64Length} B</span></div>
        <div>Wrapped Key: <span className="text-slate-200">{estimate.wrappedKeyBase64Length} B</span></div>
      </div>

      {/* Guidance alert banner */}
      <div
        className={`flex items-start gap-2 p-3 rounded-xl text-xs border ${
          estimate.isOverLimit
            ? "bg-red-950/40 border-red-500/40 text-red-200"
            : estimate.percentageOfLimit > 85
            ? "bg-amber-950/40 border-amber-500/40 text-amber-200"
            : "bg-slate-900 border-white/5 text-slate-300"
        }`}
      >
        {estimate.isOverLimit ? (
          <ShieldAlert className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
        ) : estimate.percentageOfLimit > 85 ? (
          <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
        )}
        <div className="space-y-1">
          <p className="font-medium">{estimate.guidance}</p>
          {estimate.isOverLimit && (
            <p className="text-[11px] text-red-300/80">
              Listing publication will be blocked prior to transaction signing until payload size is within limits.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
