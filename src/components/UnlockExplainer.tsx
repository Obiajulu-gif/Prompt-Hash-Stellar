
import { AlertTriangle, CheckCircle2, KeyRound, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export type UnlockState =
  | "idle"
  | "signing"
  | "verifying"
  | "success"
  | "rejected"
  | "expired"
  | "failed";

export interface UnlockExplainerProps {
  state: UnlockState;
  onRetry?: () => void;
}

const SIGNING_COPY = {
  title: "Sign to verify ownership",
  body: "Your wallet will ask you to sign a short text message. This is a free message signature — it does not move funds, approve spending, or submit any transaction to the Stellar network. The signature proves you own this wallet address so the unlock service can return the encrypted content you purchased.",
};

const STATE_COPY: Partial<
  Record<UnlockState, { title: string; body: string; tone: "info" | "success" | "warn" | "error" }>
> = {
  signing: {
    tone: "info",
    title: SIGNING_COPY.title,
    body: SIGNING_COPY.body,
  },
  verifying: {
    tone: "info",
    title: "Verifying signature…",
    body: "The unlock service is confirming your signature against the on-chain purchase record. This usually completes in under two seconds.",
  },
  success: {
    tone: "success",
    title: "Ownership confirmed",
    body: "Your signature matched the on-chain license. The decrypted prompt content is displayed below.",
  },
  rejected: {
    tone: "warn",
    title: "Signature declined",
    body: "You declined the signature request in your wallet. No funds were moved. You can retry at any time — the same prompt content is waiting for you.",
  },
  expired: {
    tone: "warn",
    title: "Challenge expired",
    body: "The unlock challenge has a short validity window for security. The previous request timed out. Retry to receive a fresh challenge — your purchased license is still valid.",
  },
  failed: {
    tone: "error",
    title: "Unlock verification failed",
    body: "The unlock service could not verify your signature. This may be a temporary network issue. Your purchase is recorded on-chain and is not affected. Retry to try again.",
  },
};

const toneStyles = {
  info: {
    container: "border-cyan-300/20 bg-cyan-300/[0.06]",
    icon: "text-cyan-300",
    title: "text-cyan-100",
    body: "text-slate-300",
  },
  success: {
    container: "border-emerald-300/20 bg-emerald-300/[0.06]",
    icon: "text-emerald-400",
    title: "text-emerald-100",
    body: "text-slate-300",
  },
  warn: {
    container: "border-amber-300/20 bg-amber-300/[0.06]",
    icon: "text-amber-300",
    title: "text-amber-100",
    body: "text-slate-300",
  },
  error: {
    container: "border-rose-300/20 bg-rose-400/[0.07]",
    icon: "text-rose-400",
    title: "text-rose-100",
    body: "text-slate-300",
  },
};

const ToneIcon = ({ tone }: { tone: "info" | "success" | "warn" | "error" }) => {
  const cls = "h-5 w-5 shrink-0";
  if (tone === "success") return <CheckCircle2 className={cls} />;
  if (tone === "warn") return <AlertTriangle className={cls} />;
  if (tone === "error") return <XCircle className={cls} />;
  return <ShieldCheck className={cls} />;
};

export function UnlockExplainer({ state, onRetry }: UnlockExplainerProps) {
  const copy = STATE_COPY[state];
  if (!copy) return null;

  const styles = toneStyles[copy.tone];
  const showRetry =
    onRetry && (state === "rejected" || state === "expired" || state === "failed");

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-xl border p-4 space-y-3 ${styles.container}`}
    >
      <div className="flex items-start gap-3">
        <span className={styles.icon}>
          <ToneIcon tone={copy.tone} />
        </span>
        <div className="space-y-1 min-w-0">
          <p className={`text-sm font-semibold ${styles.title}`}>{copy.title}</p>
          <p className={`text-xs leading-relaxed ${styles.body}`}>{copy.body}</p>
        </div>
      </div>

      {/* Message-vs-transaction distinction callout */}
      {state === "signing" && (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
          <KeyRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <p className="text-[11px] text-slate-400">
            <span className="font-semibold text-slate-200">Message sign</span>{" "}
            — not a payment. Zero XLM cost. Wallet will label this as
            &ldquo;Sign message&rdquo; or &ldquo;Personal sign&rdquo;.
          </p>
        </div>
      )}

      {showRetry && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="h-8 border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry unlock
        </Button>
      )}
    </div>
  );
}
