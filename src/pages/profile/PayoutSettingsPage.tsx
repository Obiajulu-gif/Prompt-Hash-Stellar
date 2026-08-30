import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Wallet,
  Save,
  Banknote,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/hooks/useWallet";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { usePayoutReadiness } from "@/hooks/usePayoutReadiness";
import { PayoutReadinessBanner } from "@/components/sell/PayoutReadinessBanner";
import { shortenAddress } from "@/lib/utils";
import { stellarNetwork } from "@/lib/env";
import { usePageMeta } from "@/lib/seo/usePageMeta";

const PAYOUT_STORAGE_KEY = (address: string) => `prompt-hash:payout:${address}`;

interface PayoutPreferences {
  payoutAddress: string;
}

function loadPayoutPreferences(address: string): PayoutPreferences | null {
  try {
    const raw = localStorage.getItem(PAYOUT_STORAGE_KEY(address));
    return raw ? (JSON.parse(raw) as PayoutPreferences) : null;
  } catch {
    return null;
  }
}

interface StatementLine {
  id: string;
  kind: "sale" | "refund";
  saleDate: string;
  promptTitle: string;
  promptId: string;
  buyerAddress: string;
  grossAmount: number;
  platformFee: number;
  creatorAmount: number;
  txHash: string;
  settlementStatus: "settled" | "pending" | "failed";
}

interface StatementSummary {
  grossAmount: number;
  platformFee: number;
  refunds: number;
  netSettlement: number;
  settlementStatus: "settled" | "pending" | "failed";
}

interface PayoutStatementResponse {
  statement: StatementLine[];
  summary: StatementSummary;
  status: "settled" | "pending" | "failed";
  balanced: boolean;
}

export default function PayoutSettingsPage() {
  usePageMeta({
    title: "Payout Settings",
    description:
      "Manage your creator payout preferences and connected account details.",
  });

  const { address, network } = useWallet();
  const { xlm, isLoading: isBalanceLoading } = useWalletBalance();
  const { readiness, refreshReadiness } = usePayoutReadiness();

  const savedPrefs = address ? loadPayoutPreferences(address) : null;

  const [payoutAddress, setPayoutAddress] = useState(
    savedPrefs?.payoutAddress ?? address ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statement, setStatement] = useState<PayoutStatementResponse | null>(
    null,
  );
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;

    let cancelled = false;
    setStatementLoading(true);
    setStatementError(null);

    fetch(
      `/api/prompts/creator/${encodeURIComponent(address)}/payout-statement`,
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load payout statement.");
        }
        return (await res.json()) as PayoutStatementResponse;
      })
      .then((data) => {
        if (!cancelled) setStatement(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatementError(
            err instanceof Error ? err.message : "Failed to load payout statement.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setStatementLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  // Real-time validation for payout address
  const validatePayoutAddress = (address: string): { isValid: boolean; message?: string; type?: "error" | "warning" } => {
    const trimmed = address.trim();
    
    if (!trimmed) {
      return { isValid: true }; // Empty is valid - will use wallet address
    }

    // Basic Stellar address validation
    const stellarAddressPattern = /^G[A-Z0-9]{55}$/;
    if (!stellarAddressPattern.test(trimmed)) {
      return { 
        isValid: false, 
        message: "Invalid Stellar address format", 
        type: "error" 
      };
    }

    // Warn if same as connected wallet
    if (trimmed === address) {
      return {
        isValid: true,
        message: "Using same address as connected wallet (this is fine)",
        type: "warning"
      };
    }

    return { isValid: true, message: "Valid Stellar address", type: undefined };
  };

  const addressValidation = validatePayoutAddress(payoutAddress);

  // Get payout readiness check for this specific setting
  const payoutDestinationCheck = readiness?.checks.find(c => c.id === "payout-destination");

  const handleSave = async () => {
    if (!address) return;

    setSaveError(null);
    setSaved(false);
    setSaving(true);

    try {
      await new Promise((r) => setTimeout(r, 600));
      localStorage.setItem(
        PAYOUT_STORAGE_KEY(address),
        JSON.stringify({ payoutAddress: payoutAddress.trim() || address }),
      );
      setSaved(true);
      // Refresh readiness check after saving
      setTimeout(() => {
        refreshReadiness();
      }, 100);
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : "Failed to save payout preferences.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_60%_40%_at_0%_0%,rgba(34,211,238,0.1),transparent),radial-gradient(ellipse_50%_30%_at_100%_5%,rgba(251,191,36,0.07),transparent),linear-gradient(180deg,#080b0f_0%,#0d1117_50%,#080b0f_100%)] text-white">
      <Navigation />

      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mb-6 -ml-2 text-slate-400 hover:text-white"
        >
          <Link to="/profile">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to profile
          </Link>
        </Button>

        {!address ? (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
            <div className="max-w-sm">
              <Wallet className="mx-auto h-12 w-12 text-slate-500" />
              <h1 className="mt-4 text-xl font-semibold text-white">
                Connect your wallet
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Connect a Stellar wallet to manage payout preferences.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-400">
                Creator Payments
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                Payout Settings
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Configure where your XLM earnings from prompt sales are sent.
              </p>
            </section>

            {/* Payout Readiness Status */}
            <PayoutReadinessBanner showWhenReady className="mb-2" />

            <Card className="border-white/10 bg-white/[0.03]">
              <CardContent className="p-6 space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-cyan-200" />
                    Connected Account
                  </h2>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                        Wallet Address
                      </p>
                      <p className="mt-1.5 font-mono text-sm text-slate-200">
                        {shortenAddress(address)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                        Network
                      </p>
                      <p className="mt-1.5 text-sm font-medium text-slate-200">
                        {network
                          ? network.charAt(0).toUpperCase() +
                            network.slice(1).toLowerCase()
                          : stellarNetwork
                            ? stellarNetwork.charAt(0).toUpperCase() +
                              stellarNetwork.slice(1).toLowerCase()
                            : "Unknown"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                        Balance
                      </p>
                      <p className="mt-1.5 text-lg font-bold text-white">
                        {isBalanceLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                        ) : (
                          <>
                            {xlm}{" "}
                            <span className="text-sm font-normal text-emerald-400">
                              XLM
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                        Status
                      </p>
                      <Badge className="mt-1.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Active
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-white/[0.03]">
              <CardContent className="p-6 space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Banknote className="h-5 w-5 text-emerald-400" />
                    Payout Preferences
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Earnings from prompt sales will be sent to the address
                    below.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="payoutAddress"
                      className="text-sm font-medium text-slate-200"
                    >
                      Payout XLM Address
                    </label>
                    
                    {/* Real-time validation indicator */}
                    {payoutAddress.trim() && (
                      <div className="flex items-center gap-1.5">
                        {addressValidation.isValid ? (
                          payoutDestinationCheck?.status === "pass" ? (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              Valid
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs">
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              Warning
                            </Badge>
                          )
                        ) : (
                          <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-xs">
                            <XCircle className="mr-1 h-3 w-3" />
                            Invalid
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>

                  <Input
                    id="payoutAddress"
                    value={payoutAddress}
                    onChange={(e) => {
                      setPayoutAddress(e.target.value);
                      setSaved(false);
                      setSaveError(null);
                    }}
                    placeholder={address}
                    className={`border-white/10 bg-white/[0.04] text-slate-100 font-mono ${
                      payoutAddress.trim() && !addressValidation.isValid 
                        ? "border-red-500/50 ring-1 ring-red-500/20" 
                        : ""
                    }`}
                  />
                  
                  {/* Validation feedback */}
                  {payoutAddress.trim() && addressValidation.message && (
                    <p className={`text-xs flex items-center gap-1.5 ${
                      addressValidation.type === "error" 
                        ? "text-red-400" 
                        : addressValidation.type === "warning"
                          ? "text-amber-400"
                          : "text-emerald-400"
                    }`}>
                      {addressValidation.type === "error" && <XCircle className="h-3 w-3" />}
                      {addressValidation.type === "warning" && <AlertTriangle className="h-3 w-3" />}
                      {!addressValidation.type && <CheckCircle2 className="h-3 w-3" />}
                      {addressValidation.message}
                    </p>
                  )}
                  
                  {!payoutAddress.trim() && (
                    <p className="text-xs text-slate-500">
                      Leave empty to use your connected wallet address ({shortenAddress(address)}).
                    </p>
                  )}

                  {/* Payout destination readiness status */}
                  {payoutDestinationCheck && (
                    <div className={`text-xs p-3 rounded-lg border ${
                      payoutDestinationCheck.status === "pass"
                        ? "border-emerald-400/20 bg-emerald-500/5 text-emerald-200"
                        : payoutDestinationCheck.status === "warn" 
                          ? "border-amber-400/20 bg-amber-500/5 text-amber-200"
                          : "border-red-400/20 bg-red-500/5 text-red-200"
                    }`}>
                      <div className="flex items-center gap-2">
                        {payoutDestinationCheck.status === "pass" && <CheckCircle2 className="h-3.5 w-3.5" />}
                        {payoutDestinationCheck.status === "warn" && <AlertTriangle className="h-3.5 w-3.5" />}
                        {payoutDestinationCheck.status === "fail" && <XCircle className="h-3.5 w-3.5" />}
                        <span className="font-medium">{payoutDestinationCheck.name}</span>
                      </div>
                      <p className="mt-1 text-xs opacity-90">
                        {payoutDestinationCheck.message}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <Button
                    onClick={() => void handleSave()}
                    disabled={saving || !addressValidation.isValid}
                    className="h-10 bg-emerald-400 text-slate-950 hover:bg-emerald-300 disabled:opacity-60"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Save preferences
                      </>
                    )}
                  </Button>

                  {saved && !saving && (
                    <p className="flex items-center gap-1.5 text-sm text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Payout preferences saved
                    </p>
                  )}

                  {saveError && (
                    <p className="flex items-center gap-1.5 text-sm text-red-400">
                      <AlertCircle className="h-4 w-4" />
                      {saveError}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-5 py-4 text-sm text-cyan-100">
              <div className="flex items-start gap-3">
                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Stellar Network Payments</p>
                  <p className="mt-1 text-xs text-cyan-100/80">
                    All payouts are processed on the Stellar network. XLM
                    earnings from prompt sales are sent directly to your
                    configured payout address. Transactions can be verified on
                    the Stellar block explorer.
                  </p>
                </div>
                <div className="flex-shrink-0">
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-cyan-400/20 text-cyan-300 hover:bg-cyan-500/10"
                  >
                    <Link to="/sell/payout-readiness">
                      Check Full Setup
                    </Link>
                  </Button>
                </div>
              </div>
            </div>

            <Card className="border-white/10 bg-white/[0.03]">
              <CardContent className="p-6 space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                      <Banknote className="h-5 w-5 text-cyan-200" />
                      Payout Statement
                    </h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Your sales are reconciled against platform fees, refunds,
                      and net settlement so every statement balances.
                    </p>
                  </div>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                  >
                    <a
                      href={`/api/prompts/creator/${encodeURIComponent(address)}/payout-statement?format=csv`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download className="mr-1.5 h-4 w-4" />
                      Export CSV
                    </a>
                  </Button>
                </div>

                {statementLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading payout statement...
                  </div>
                ) : statementError ? (
                  <div className="flex items-center gap-2 text-sm text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {statementError}
                  </div>
                ) : statement ? (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <SummaryStat
                        label="Gross Sales"
                        value={statement.summary.grossAmount}
                        accent="text-cyan-200"
                      />
                      <SummaryStat
                        label="Platform Fees"
                        value={statement.summary.platformFee}
                        accent="text-amber-300"
                      />
                      <SummaryStat
                        label="Refunds"
                        value={statement.summary.refunds}
                        accent="text-rose-300"
                      />
                      <SummaryStat
                        label="Net Settlement"
                        value={statement.summary.netSettlement}
                        accent="text-emerald-300"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <SettlementBadge status={statement.status} />
                      {statement.balanced ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Statement balances gross, fees, refunds, and net
                          payout.
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <AlertCircle className="h-3.5 w-3.5" />
                          Statement is out of balance - please contact support.
                        </span>
                      )}
                    </div>

                    {statement.statement.length > 0 ? (
                      <div className="max-h-72 overflow-y-auto rounded-xl border border-white/10">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-[#0d1117] text-slate-400">
                            <tr className="border-b border-white/10">
                              <th className="px-3 py-2 font-medium">Date</th>
                              <th className="px-3 py-2 font-medium">Prompt</th>
                              <th className="px-3 py-2 font-medium">Type</th>
                              <th className="px-3 py-2 font-medium text-right">
                                Gross
                              </th>
                              <th className="px-3 py-2 font-medium text-right">
                                Fee
                              </th>
                              <th className="px-3 py-2 font-medium text-right">
                                Net
                              </th>
                              <th className="px-3 py-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody className="text-slate-300">
                            {statement.statement.map((line) => (
                              <tr
                                key={line.id}
                                className="border-b border-white/5 last:border-0"
                              >
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {line.saleDate.slice(0, 10)}
                                </td>
                                <td className="px-3 py-2 max-w-40 truncate">
                                  {line.promptTitle}
                                </td>
                                <td className="px-3 py-2 uppercase">
                                  {line.kind}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {line.grossAmount}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {line.platformFee}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {line.creatorAmount}
                                </td>
                                <td className="px-3 py-2">
                                  <SettlementBadge
                                    status={line.settlementStatus}
                                    compact
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">
                        No sales in the current statement period yet.
                      </p>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

function SummaryStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className={`mt-1.5 font-mono text-lg font-bold ${accent}`}>{value}</p>
    </div>
  );
}

function SettlementBadge({
  status,
  compact,
}: {
  status: "settled" | "pending" | "failed";
  compact?: boolean;
}) {
  const styles =
    status === "settled"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : status === "pending"
        ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
        : "bg-rose-500/10 text-rose-300 border-rose-500/20";
  const label =
    status === "settled"
      ? "Settled"
      : status === "pending"
        ? "Pending"
        : "Failed";
  return (
    <Badge className={`border ${styles} ${compact ? "text-[10px]" : ""}`}>
      {label}
    </Badge>
  );
}
