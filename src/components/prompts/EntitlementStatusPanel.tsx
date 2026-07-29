import type { ReactNode } from "react";
import {
  BadgeCheck,
  Clock,
  ExternalLink,
  Hash,
  RefreshCw,
  ShieldQuestion,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import type { EntitlementDescriptor } from "@/lib/prompts/entitlementStatus";

export interface EntitlementStatusPanelProps {
  descriptor: EntitlementDescriptor;
  /** Purchase transaction hash, once the receipt has been indexed. */
  transactionHash?: string;
  /** Licence/content revision at the time of purchase. */
  licenceVersion?: number;
  /** Retry loading the purchase transaction/licence reference (indexing delay). */
  onRetryReference?: () => void;
  isRetryingReference?: boolean;
  /** Retry the wallet-signature verification step. */
  onRetryVerification?: () => void;
  isRetryingVerification?: boolean;
}

const TONE_STYLES: Record<
  EntitlementDescriptor["state"],
  { container: string; badge: string; icon: ReactNode }
> = {
  active: {
    container: "border-emerald-300/20 bg-emerald-300/[0.05]",
    badge: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
    icon: <BadgeCheck className="h-4 w-4" />,
  },
  pending: {
    container: "border-amber-300/20 bg-amber-300/[0.05]",
    badge: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    icon: <Clock className="h-4 w-4" />,
  },
  unavailable: {
    container: "border-slate-500/20 bg-slate-500/[0.05]",
    badge: "border-slate-400/30 bg-slate-400/10 text-slate-300",
    icon: <XCircle className="h-4 w-4" />,
  },
  verification_needed: {
    container: "border-cyan-300/20 bg-cyan-300/[0.05]",
    badge: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
    icon: <ShieldQuestion className="h-4 w-4" />,
  },
};

function truncateMiddle(value: string, lead = 10, tail = 6): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/**
 * Entitlement / licence status panel — Issue #490.
 *
 * Gives buyers an at-a-glance summary of a purchased prompt's access state
 * (active / pending indexing / unavailable / verification needed), the
 * purchase transaction and licence version references when available, and a
 * retry action scoped to whichever part is delayed (indexing vs. wallet
 * verification) so a slow indexer never looks the same as a failed unlock.
 */
export function EntitlementStatusPanel({
  descriptor,
  transactionHash,
  licenceVersion,
  onRetryReference,
  isRetryingReference,
  onRetryVerification,
  isRetryingVerification,
}: EntitlementStatusPanelProps) {
  const tone = TONE_STYLES[descriptor.state];
  const network = browserStellarConfig.networkPassphrase?.includes("Test")
    ? "testnet"
    : "public";

  return (
    <div
      data-testid="entitlement-status-panel"
      data-state={descriptor.state}
      className={`rounded-xl border p-4 space-y-3 ${tone.container}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone.badge}`}
        >
          {tone.icon}
          {descriptor.label}
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
          Licence entitlement
        </span>
      </div>

      <p className="text-xs leading-relaxed text-slate-300">
        {descriptor.summary}
      </p>

      <p className="text-[11px] font-medium text-slate-400">
        Unlock readiness:{" "}
        <span className="text-slate-200">{descriptor.unlockReadiness}</span>
      </p>

      <div className="grid grid-cols-1 gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Purchase transaction
          </p>
          {transactionHash ? (
            <a
              href={`https://stellar.expert/explorer/${network}/tx/${transactionHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-xs text-blue-400 underline decoration-blue-400/30 underline-offset-2 hover:text-blue-300"
            >
              {truncateMiddle(transactionHash)}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <p className="mt-0.5 text-xs italic text-slate-500">
              Not available yet
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Licence version
          </p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-xs text-slate-200">
            <Hash className="h-3 w-3 text-slate-500" />
            {licenceVersion !== undefined ? `v${licenceVersion}` : "—"}
          </p>
        </div>
      </div>

      {(onRetryReference || onRetryVerification) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {descriptor.state === "pending" && onRetryReference && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetryReference}
              disabled={isRetryingReference}
              className="h-8 border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {isRetryingReference ? "Checking…" : "Check indexing again"}
            </Button>
          )}
          {descriptor.state === "verification_needed" &&
            onRetryVerification &&
            descriptor.unlockReadiness !== "Verifying wallet signature…" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRetryVerification}
                disabled={isRetryingVerification}
                className="h-8 border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry verification
              </Button>
            )}
        </div>
      )}
    </div>
  );
}
