import { useEffect, useState } from "react";
import { Server } from "@stellar/stellar-sdk/rpc";
import { Contract } from "@stellar/stellar-sdk";
import {
  AlertTriangle,
  Coins,
  Copy,
  Cpu,
  ExternalLink,
  Key,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { readContract } from "@/lib/stellar/tx";
import { copyToClipboard } from "@/lib/clipboard/secureClipboard";
import { stellarExpertAccountUrl } from "@/lib/stellar/explorer";

interface ContractConfigState {
  owner: string | null;
  feePercentage: number | null;
  referralPercentage: number | null;
  feeWallet: string | null;
  xlmSac: string | null;
  isPaused: boolean | null;
  wasmHash: string | null;
}

export default function ConfigDashboard() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [onChainData, setOnChainData] = useState<ContractConfigState | null>(null);

  // Map network passphrase to readable name
  const getNetworkName = (passphrase: string) => {
    if (passphrase.includes("Test SDF Network")) return "Testnet";
    if (passphrase.includes("Public Global Stellar Network")) return "Mainnet";
    if (passphrase.includes("Test SDF Future Network")) return "Futurenet";
    return "Local / Standalone";
  };

  const loadContractConfig = async () => {
    setLoading(true);
    setErrorMsg(null);

    const simAccount =
      browserStellarConfig.simulationAccount ||
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    const readConfig = {
      ...browserStellarConfig,
      simulationAccount: simAccount,
    };

    try {
      // Query WASM Hash via footprint lookup first
      const server = new Server(readConfig.rpcUrl, { allowHttp: readConfig.allowHttp });
      const contractLedgerKey = new Contract(readConfig.promptHashContractId).getFootprint();
      
      let wasmHashVal: string | null = null;
      try {
        const response = await server.getLedgerEntries(contractLedgerKey);
        if (response.entries && response.entries.length > 0 && response.entries[0]?.val) {
          wasmHashVal = response.entries[0].val
            .contractData()
            .val()
            .instance()
            .executable()
            .wasmHash()
            .toString("hex");
        }
      } catch (err) {
        console.warn("Footprint resolution failed:", err);
      }

      // Execute read-only contract calls in parallel
      const [owner, feePercentage, referralPercentage, feeWallet, xlmSac, isPaused] =
        await Promise.all([
          readContract<string>(readConfig, readConfig.promptHashContractId, "owner").catch(() => "Unavailable"),
          readContract<number>(readConfig, readConfig.promptHashContractId, "get_fee_percentage").catch(() => -1),
          readContract<number>(readConfig, readConfig.promptHashContractId, "get_referral_percentage").catch(() => -1),
          readContract<string | null>(readConfig, readConfig.promptHashContractId, "get_fee_wallet").catch(() => null),
          readContract<string | null>(readConfig, readConfig.promptHashContractId, "get_xlm_sac").catch(() => null),
          readContract<boolean>(readConfig, readConfig.promptHashContractId, "is_paused").catch(() => false),
        ]);

      setOnChainData({
        owner: owner === "Unavailable" ? null : owner,
        feePercentage: feePercentage === -1 ? null : feePercentage,
        referralPercentage: referralPercentage === -1 ? null : referralPercentage,
        feeWallet,
        xlmSac,
        isPaused,
        wasmHash: wasmHashVal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load contract state.";
      setErrorMsg(message);
      setOnChainData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadContractConfig();
  }, []);

  const handleCopy = async (key: string, text: string) => {
    const result = await copyToClipboard(text);
    if (result.success) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const networkName = getNetworkName(browserStellarConfig.networkPassphrase);

  return (
    <div className="min-h-screen bg-[#020617] p-6 text-white">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-4xl font-bold">Contract Diagnostics</h1>
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                Read-Only
              </Badge>
            </div>
            <p className="mt-2 text-slate-400">
              Expose and verify deployed Soroban smart contract parameters and workspace environments.
            </p>
          </div>
          <Button
            onClick={() => void loadContractConfig()}
            disabled={loading}
            variant="outline"
            className="border-white/10 bg-white/5 hover:bg-white/10"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh State
          </Button>
        </div>

        {/* Diagnostics & Comparison Layout */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Main Configuration Details */}
          <div className="space-y-6 lg:col-span-2">
            <Card className="border-white/10 bg-white/5">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl text-white">Active On-Chain Configuration</CardTitle>
                  {loading ? (
                    <Badge variant="outline" className="border-slate-500/30 bg-slate-500/10 text-slate-300">
                      Querying...
                    </Badge>
                  ) : onChainData ? (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                      Synchronized
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-400">
                      Offline / Not Deployed
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-slate-400">
                  Live state retrieved from the deployed contract.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Paused State Badge */}
                {onChainData && (
                  <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-slate-900/50 p-3">
                    {onChainData.isPaused ? (
                      <>
                        <Pause className="h-5 w-5 text-amber-400" />
                        <span className="text-sm font-semibold text-amber-400">
                          Contract execution is currently PAUSED.
                        </span>
                      </>
                    ) : (
                      <>
                        <Play className="h-5 w-5 text-emerald-400" />
                        <span className="text-sm font-semibold text-emerald-400">
                          Contract execution is active and operational.
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* Properties list */}
                <div className="space-y-3">
                  {/* Contract Version/WASM Hash */}
                  <div className="rounded-lg border border-white/5 bg-slate-950/40 p-4">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <Cpu className="h-3.5 w-3.5" />
                        Contract Version (Wasm Hash)
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-4 font-mono text-sm">
                      <span className="truncate text-slate-200">
                        {onChainData?.wasmHash || (loading ? "Querying ledger..." : "Not Found / Null")}
                      </span>
                      {onChainData?.wasmHash && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 hover:bg-white/10"
                          onClick={() => void handleCopy("wasmHash", onChainData.wasmHash!)}
                        >
                          <Copy className="h-4 w-4" />
                          <span className="sr-only">Copy</span>
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Owner/Admin Address */}
                  <div className="rounded-lg border border-white/5 bg-slate-950/40 p-4">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <Key className="h-3.5 w-3.5" />
                      Admin (Owner) Address
                    </span>
                    <div className="mt-1 flex items-center justify-between gap-4 font-mono text-sm">
                      <span className="truncate text-slate-200">
                        {onChainData?.owner || (loading ? "Querying owner..." : "Unavailable")}
                      </span>
                      <div className="flex gap-1 shrink-0">
                        {onChainData?.owner && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 hover:bg-white/10"
                              onClick={() => void handleCopy("owner", onChainData.owner!)}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <a
                              href={stellarExpertAccountUrl(onChainData.owner)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10"
                            >
                              <ExternalLink className="h-4 w-4 text-slate-400" />
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Fee Settings */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-lg border border-white/5 bg-slate-950/40 p-4">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Platform Fee
                      </span>
                      <p className="mt-1 text-2xl font-bold text-slate-150">
                        {onChainData?.feePercentage !== null && onChainData?.feePercentage !== undefined
                          ? `${(onChainData!.feePercentage! / 100).toFixed(2)}%`
                          : loading
                          ? "..."
                          : "Unavailable"}
                      </p>
                    </div>

                    <div className="rounded-lg border border-white/5 bg-slate-950/40 p-4">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Referral Split
                      </span>
                      <p className="mt-1 text-2xl font-bold text-slate-150">
                        {onChainData?.referralPercentage !== null && onChainData?.referralPercentage !== undefined
                          ? `${(onChainData!.referralPercentage! / 100).toFixed(2)}%`
                          : loading
                          ? "..."
                          : "Unavailable"}
                      </p>
                    </div>
                  </div>

                  {/* Fee Wallet Address */}
                  <div className="rounded-lg border border-white/5 bg-slate-950/40 p-4">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Platform Fee Wallet
                    </span>
                    <div className="mt-1 flex items-center justify-between gap-4 font-mono text-sm">
                      <span className="truncate text-slate-200">
                        {onChainData?.feeWallet || (loading ? "Querying wallet..." : "Unavailable")}
                      </span>
                      <div className="flex gap-1 shrink-0">
                        {onChainData?.feeWallet && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 hover:bg-white/10"
                              onClick={() => void handleCopy("feeWallet", onChainData.feeWallet!)}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <a
                              href={stellarExpertAccountUrl(onChainData.feeWallet)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10"
                            >
                              <ExternalLink className="h-4 w-4 text-slate-400" />
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Accepted Asset (Native Token SAC) */}
                  <div className="rounded-lg border border-white/5 bg-slate-950/40 p-4">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <Coins className="h-3.5 w-3.5" />
                      On-Chain Accepted Asset (Native SAC)
                    </span>
                    <div className="mt-1 flex items-center justify-between gap-4 font-mono text-sm">
                      <span className="truncate text-slate-200">
                        {onChainData?.xlmSac || (loading ? "Querying asset..." : "Unavailable")}
                      </span>
                      <div className="flex gap-1 shrink-0">
                        {onChainData?.xlmSac && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 hover:bg-white/10"
                              onClick={() => void handleCopy("xlmSac", onChainData.xlmSac!)}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <a
                              href={stellarExpertAccountUrl(onChainData.xlmSac)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10"
                            >
                              <ExternalLink className="h-4 w-4 text-slate-400" />
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Error alerts / warnings */}
            {errorMsg && (
              <div className="flex gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
                <div>
                  <p className="font-semibold">On-Chain Lookup Warning</p>
                  <p className="mt-1 text-slate-350">{errorMsg}</p>
                </div>
              </div>
            )}
          </div>

          {/* Deployment Expectations Panel */}
          <div className="lg:col-span-1">
            <div className="sticky top-6 space-y-6">
              <Card className="border-white/10 bg-white/5">
                <CardHeader>
                  <CardTitle className="text-xl text-white">Expected Deployment Config</CardTitle>
                  <CardDescription className="text-slate-400">
                    Expected settings parsed from client environment.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Stellar Network
                    </label>
                    <p className="mt-1 font-semibold text-slate-200">{networkName}</p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Network Passphrase
                    </label>
                    <div className="mt-1 flex items-center justify-between font-mono text-xs">
                      <span className="truncate text-slate-300">
                        {browserStellarConfig.networkPassphrase}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 hover:bg-white/10"
                        onClick={() =>
                          void handleCopy("passphrase", browserStellarConfig.networkPassphrase)
                        }
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      RPC Server URL
                    </label>
                    <div className="mt-1 flex items-center justify-between font-mono text-xs">
                      <span className="truncate text-slate-300">{browserStellarConfig.rpcUrl}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 hover:bg-white/10"
                        onClick={() => void handleCopy("rpcUrl", browserStellarConfig.rpcUrl)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Expected Contract ID
                    </label>
                    <div className="mt-1 flex items-center justify-between font-mono text-xs">
                      <span className="truncate text-slate-300">
                        {browserStellarConfig.promptHashContractId}
                      </span>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 hover:bg-white/10"
                          onClick={() =>
                            void handleCopy("contractId", browserStellarConfig.promptHashContractId)
                          }
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <a
                          href={stellarExpertAccountUrl(browserStellarConfig.promptHashContractId)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10"
                        >
                          <ExternalLink className="h-3 w-3 text-slate-400" />
                        </a>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Expected Native Asset ID
                    </label>
                    <div className="mt-1 flex items-center justify-between font-mono text-xs">
                      <span className="truncate text-slate-300">
                        {browserStellarConfig.nativeAssetContractId}
                      </span>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 hover:bg-white/10"
                          onClick={() =>
                            void handleCopy(
                              "expectedSac",
                              browserStellarConfig.nativeAssetContractId
                            )
                          }
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <a
                          href={stellarExpertAccountUrl(browserStellarConfig.nativeAssetContractId)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10"
                        >
                          <ExternalLink className="h-3 w-3 text-slate-400" />
                        </a>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Copy toast feedback banner */}
              {copiedKey && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-center text-xs text-emerald-300 animate-in fade-in duration-300">
                  Value copied to clipboard!
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
