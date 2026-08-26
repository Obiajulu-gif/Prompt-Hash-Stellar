import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Wallet,
  Save,
  Banknote,
} from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/hooks/useWallet";
import { useWalletBalance } from "@/hooks/useWalletBalance";
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

export default function PayoutSettingsPage() {
  usePageMeta({
    title: "Payout Settings",
    description:
      "Manage your creator payout preferences and connected account details.",
  });

  const { address, network } = useWallet();
  const { xlm, isLoading: isBalanceLoading } = useWalletBalance();

  const savedPrefs = address ? loadPayoutPreferences(address) : null;

  const [payoutAddress, setPayoutAddress] = useState(
    savedPrefs?.payoutAddress ?? address ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

                <div className="space-y-2">
                  <label
                    htmlFor="payoutAddress"
                    className="text-sm font-medium text-slate-200"
                  >
                    Payout XLM Address
                  </label>
                  <Input
                    id="payoutAddress"
                    value={payoutAddress}
                    onChange={(e) => {
                      setPayoutAddress(e.target.value);
                      setSaved(false);
                      setSaveError(null);
                    }}
                    placeholder={address}
                    className="border-white/10 bg-white/[0.04] text-slate-100 font-mono"
                  />
                  <p className="text-xs text-slate-500">
                    Leave empty to use your connected wallet address.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <Button
                    onClick={() => void handleSave()}
                    disabled={saving}
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
                <div>
                  <p className="font-medium">Stellar Network Payments</p>
                  <p className="mt-1 text-xs text-cyan-100/80">
                    All payouts are processed on the Stellar network. XLM
                    earnings from prompt sales are sent directly to your
                    configured payout address. Transactions can be verified on
                    the Stellar block explorer.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
