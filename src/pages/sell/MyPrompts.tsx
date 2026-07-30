import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CalendarDays,
  CheckSquare,
  Eye,
  Loader2,
  LockKeyhole,
  PackagePlus,
  Pause,
  Play,
  ShoppingBag,
  Square,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CreatorDashboard } from "@/components/sell/CreatorDashboard";
import { PostVersionUpdate } from "@/components/PostVersionUpdate";
import { useWallet } from "@/hooks/useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import {
  getPromptsByBuyer,
  getPromptsByCreator,
  createAccessPass,
  createBundle,
  setPromptSaleStatus,
  updatePromptPrice,
} from "@/lib/stellar/promptHashClient";
import {
  formatPriceLabel,
  stroopsToXlmString,
  xlmToStroops,
} from "@/lib/stellar/format";
import { unlockPromptContent } from "@/lib/prompts/unlock";
import {
  archivePrompt,
  restorePrompt,
  getArchivedPromptIds,
} from "@/lib/prompts/PromptArchiveStore";

interface MyPromptsProps {
  onCreateNew?: () => void;
}

const MyPrompts = ({ onCreateNew }: MyPromptsProps) => {
  const queryClient = useQueryClient();
  const { address, signMessage, signTransaction } = useWallet();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null);
  const [busyOffer, setBusyOffer] = useState<"bundle" | "pass" | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [unlockedPrompts, setUnlockedPrompts] = useState<
    Record<string, string>
  >({});
  const [bundleTitle, setBundleTitle] = useState("Creator bundle");
  const [bundlePriceXlm, setBundlePriceXlm] = useState("5");
  const [bundlePromptIds, setBundlePromptIds] = useState<string[]>([]);
  const [passTitle, setPassTitle] = useState("30-day catalog pass");
  const [passPriceXlm, setPassPriceXlm] = useState("12");
  const [passDurationDays, setPassDurationDays] = useState("30");
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);

  // Issue #500: Bulk status actions state
  const [selectedPromptIds, setSelectedPromptIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkResults, setBulkResults] = useState<{
    actionName: string;
    successCount: number;
    failureCount: number;
    details: Array<{ id: string; title: string; success: boolean; error?: string }>;
  } | null>(null);
  const [isRetireModalOpen, setIsRetireModalOpen] = useState(false);

  const createdQuery = useQuery({
    queryKey: ["created-prompts", address],
    queryFn: async () =>
      address ? getPromptsByCreator(browserStellarConfig, address) : [],
    enabled: Boolean(address),
  });

  const purchasedQuery = useQuery({
    queryKey: ["purchased-prompts", address],
    queryFn: async () =>
      address ? getPromptsByBuyer(browserStellarConfig, address) : [],
    enabled: Boolean(address),
  });

  const createdPrompts = createdQuery.data ?? [];
  const purchasedPrompts = purchasedQuery.data ?? [];

  useEffect(() => {
    if (address) {
      setArchivedIds(getArchivedPromptIds(address));
    } else {
      setArchivedIds(new Set());
    }
  }, [address]);

  const mergedDrafts = useMemo(() => {
    return Object.fromEntries(
      createdPrompts.map((prompt) => [
        prompt.id.toString(),
        priceDrafts[prompt.id.toString()] ??
          stroopsToXlmString(prompt.priceStroops),
      ]),
    );
  }, [createdPrompts, priceDrafts]);

  const activeCreatedPrompts = useMemo(
    () => createdPrompts.filter((p) => !archivedIds.has(p.id.toString())),
    [createdPrompts, archivedIds],
  );
  const archivedCreatedPrompts = useMemo(
    () => createdPrompts.filter((p) => archivedIds.has(p.id.toString())),
    [createdPrompts, archivedIds],
  );

  const dashboardStats = useMemo(() => {
    const totalSales = createdPrompts.reduce(
      (sum, p) => sum + (p.salesCount ?? 0),
      0,
    );
    const totalRevenue = createdPrompts.reduce(
      (sum, p) => sum + p.priceStroops * BigInt(p.salesCount ?? 0),
      BigInt(0),
    );
    const activeListings = activeCreatedPrompts.filter((p) => p.active).length;

    return {
      totalListings: activeCreatedPrompts.length,
      totalSales,
      totalRevenue: stroopsToXlmString(totalRevenue),
      activeListings,
    };
  }, [createdPrompts, activeCreatedPrompts]);

  const refreshPromptLists = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["created-prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["purchased-prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["marketplace-prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["prompt-access"] }),
    ]);
  };

  const updateStatus = (message: string) => {
    setErrorMessage(null);
    setStatusMessage(message);
  };

  const updateError = (message: string) => {
    setStatusMessage(null);
    setErrorMessage(message);
  };

  const handleToggleSaleStatus = async (promptId: bigint, active: boolean) => {
    if (!address || !signTransaction) {
      updateError("Connect a wallet before changing prompt status.");
      return;
    }

    setBusyPromptId(promptId.toString());
    try {
      await setPromptSaleStatus(
        browserStellarConfig,
        { signTransaction },
        address,
        promptId.toString(),
        !active,
      );
      updateStatus(!active ? "Prompt reactivated." : "Prompt deactivated.");
      await refreshPromptLists();
    } catch (error) {
      updateError(
        error instanceof Error
          ? error.message
          : "Failed to update sale status.",
      );
    } finally {
      setBusyPromptId(null);
    }
  };

  const handleArchive = (promptId: string) => {
    if (!address) return;
    archivePrompt(address, promptId);
    setArchivedIds(getArchivedPromptIds(address));
    updateStatus("Prompt archived. It's hidden from the default view but preserved.");
  };

  const handleRestore = (promptId: string) => {
    if (!address) return;
    restorePrompt(address, promptId);
    setArchivedIds(getArchivedPromptIds(address));
    updateStatus("Prompt restored.");
  };

  // Issue #500: Selection & Bulk Status Update Handlers
  const toggleSelectPrompt = (promptId: string) => {
    setSelectedPromptIds((prev) => {
      const next = new Set(prev);
      if (next.has(promptId)) {
        next.delete(promptId);
      } else {
        next.add(promptId);
      }
      return next;
    });
  };

  const handleSelectAllActive = () => {
    const allIds = activeCreatedPrompts.map((p) => p.id.toString());
    setSelectedPromptIds(new Set(allIds));
  };

  const handleDeselectAll = () => {
    setSelectedPromptIds(new Set());
  };

  const executeBulkStatusChange = async (targetActive: boolean, actionLabel: string) => {
    if (!address || !signTransaction) {
      updateError("Connect a wallet before updating prompt statuses.");
      return;
    }

    if (selectedPromptIds.size === 0) {
      updateError("Select at least one listing for bulk status update.");
      return;
    }

    setIsBulkProcessing(true);
    setBulkResults(null);
    setStatusMessage(null);
    setErrorMessage(null);

    const targetPrompts = activeCreatedPrompts.filter((p) =>
      selectedPromptIds.has(p.id.toString())
    );

    let successCount = 0;
    let failureCount = 0;
    const details: Array<{ id: string; title: string; success: boolean; error?: string }> = [];

    for (const prompt of targetPrompts) {
      const promptIdStr = prompt.id.toString();
      try {
        await setPromptSaleStatus(
          browserStellarConfig,
          { signTransaction },
          address,
          promptIdStr,
          targetActive,
        );
        successCount++;
        details.push({ id: promptIdStr, title: prompt.title, success: true });
      } catch (err) {
        failureCount++;
        const errMsg = err instanceof Error ? err.message : "Status update failed";
        details.push({ id: promptIdStr, title: prompt.title, success: false, error: errMsg });
      }
    }

    setBulkResults({
      actionName: actionLabel,
      successCount,
      failureCount,
      details,
    });

    if (successCount > 0) {
      await refreshPromptLists();
    }

    setIsBulkProcessing(false);
    setSelectedPromptIds(new Set());
  };

  const handleConfirmBulkRetire = async () => {
    setIsRetireModalOpen(false);
    await executeBulkStatusChange(false, "Retire");
  };

  const handleUpdatePrice = async (promptId: bigint) => {
    if (!address || !signTransaction) {
      updateError("Connect a wallet before updating prompt prices.");
      return;
    }

    setBusyPromptId(promptId.toString());
    try {
      const nextPrice = xlmToStroops(mergedDrafts[promptId.toString()]);
      await updatePromptPrice(
        browserStellarConfig,
        { signTransaction },
        address,
        promptId.toString(),
        nextPrice.toString(),
      );
      updateStatus("Prompt price updated.");
      await refreshPromptLists();
    } catch (error) {
      updateError(
        error instanceof Error ? error.message : "Failed to update price.",
      );
    } finally {
      setBusyPromptId(null);
    }
  };

  const handleUnlock = async (promptId: bigint) => {
    if (!address || !signMessage) {
      updateError(
        "Connect a wallet with SEP-43 message signing to unlock prompts.",
      );
      return;
    }

    setBusyPromptId(promptId.toString());
    try {
      const response = await unlockPromptContent(
        address,
        promptId.toString(),
        signMessage,
      );
      setUnlockedPrompts((current) => ({
        ...current,
        [promptId.toString()]: response.plaintext,
      }));
      updateStatus("Prompt unlocked.");
    } catch (error) {
      updateError(
        error instanceof Error ? error.message : "Failed to unlock prompt.",
      );
    } finally {
      setBusyPromptId(null);
    }
  };

  const toggleBundlePrompt = (promptId: string) => {
    setBundlePromptIds((current) =>
      current.includes(promptId)
        ? current.filter((id) => id !== promptId)
        : [...current, promptId],
    );
  };

  const handleCreateBundle = async () => {
    if (!address || !signTransaction) {
      updateError("Connect a wallet before creating bundle offers.");
      return;
    }
    if (bundlePromptIds.length < 2) {
      updateError("Select at least two prompts for a bundle.");
      return;
    }

    setBusyOffer("bundle");
    try {
      const { bundleId } = await createBundle(
        browserStellarConfig,
        { signTransaction },
        address,
        {
          title: bundleTitle.trim(),
          promptIds: bundlePromptIds,
          priceStroops: xlmToStroops(bundlePriceXlm),
        },
      );
      updateStatus(`Bundle #${bundleId} created.`);
      setBundlePromptIds([]);
      await refreshPromptLists();
    } catch (error) {
      updateError(
        error instanceof Error ? error.message : "Failed to create bundle.",
      );
    } finally {
      setBusyOffer(null);
    }
  };

  const handleCreateAccessPass = async () => {
    if (!address || !signTransaction) {
      updateError("Connect a wallet before creating access passes.");
      return;
    }

    const durationDays = Number(passDurationDays);
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      updateError("Enter a valid pass duration.");
      return;
    }

    setBusyOffer("pass");
    try {
      const { passId } = await createAccessPass(
        browserStellarConfig,
        { signTransaction },
        address,
        {
          title: passTitle.trim(),
          durationSecs: Math.round(durationDays * 24 * 60 * 60),
          priceStroops: xlmToStroops(passPriceXlm),
        },
      );
      updateStatus(`Access pass #${passId} created.`);
      await refreshPromptLists();
    } catch (error) {
      updateError(
        error instanceof Error
          ? error.message
          : "Failed to create access pass.",
      );
    } finally {
      setBusyOffer(null);
    }
  };

  if (!address) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-slate-300">
        Connect your Stellar wallet to manage created and purchased prompts.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <CreatorDashboard
        stats={dashboardStats}
        isLoading={createdQuery.isLoading}
        isError={createdQuery.isError}
        onRefresh={refreshPromptLists}
      />

      {statusMessage ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {statusMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-white">
            Bundles and access passes
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Group prompts into discounted bundles or sell time-bound access to
            your catalog.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-start gap-3">
              <PackagePlus className="mt-1 h-5 w-5 text-emerald-300" />
              <div>
                <h3 className="font-semibold text-white">Create bundle</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Buyers unlock every selected prompt with one purchase.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_140px]">
              <Input
                value={bundleTitle}
                onChange={(event) => setBundleTitle(event.target.value)}
                placeholder="Bundle title"
              />
              <Input
                value={bundlePriceXlm}
                onChange={(event) => setBundlePriceXlm(event.target.value)}
                inputMode="decimal"
                placeholder="Price XLM"
              />
            </div>
            <div className="mt-4 space-y-2">
              {createdPrompts.length < 2 ? (
                <p className="text-sm text-slate-400">
                  Create at least two prompts before publishing a bundle.
                </p>
              ) : (
                createdPrompts.map((prompt) => {
                  const id = prompt.id.toString();
                  return (
                    <label
                      key={id}
                      className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
                    >
                      <input
                        type="checkbox"
                        checked={bundlePromptIds.includes(id)}
                        onChange={() => toggleBundlePrompt(id)}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-950"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {prompt.title}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatPriceLabel(prompt.priceStroops)}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <Button
              type="button"
              className="mt-5 w-full gap-2 bg-emerald-400 text-slate-950 hover:bg-emerald-300"
              onClick={handleCreateBundle}
              disabled={busyOffer === "bundle" || createdPrompts.length < 2}
            >
              {busyOffer === "bundle" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Create bundle
            </Button>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-1 h-5 w-5 text-cyan-300" />
              <div>
                <h3 className="font-semibold text-white">
                  Create catalog pass
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  Buyers unlock your prompts until the pass expires.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3">
              <Input
                value={passTitle}
                onChange={(event) => setPassTitle(event.target.value)}
                placeholder="Pass title"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={passPriceXlm}
                  onChange={(event) => setPassPriceXlm(event.target.value)}
                  inputMode="decimal"
                  placeholder="Price XLM"
                />
                <Input
                  value={passDurationDays}
                  onChange={(event) => setPassDurationDays(event.target.value)}
                  inputMode="numeric"
                  placeholder="Duration days"
                />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-5 w-full gap-2"
              onClick={handleCreateAccessPass}
              disabled={busyOffer === "pass" || createdPrompts.length === 0}
            >
              {busyOffer === "pass" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Create access pass
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-white">Created by me</h2>
            <p className="mt-2 text-sm text-slate-400">
              Update pricing, pause listings, and track license sales without changing ownership.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeCreatedPrompts.length > 0 && (
              <button
                type="button"
                onClick={
                  selectedPromptIds.size === activeCreatedPrompts.length
                    ? handleDeselectAll
                    : handleSelectAllActive
                }
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition border border-white/10 rounded-lg px-3 py-2 bg-white/5"
              >
                {selectedPromptIds.size === activeCreatedPrompts.length ? (
                  <CheckSquare className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Square className="h-3.5 w-3.5 text-slate-400" />
                )}
                {selectedPromptIds.size === activeCreatedPrompts.length
                  ? "Deselect All"
                  : `Select All (${activeCreatedPrompts.length})`}
              </button>
            )}
            {archivedCreatedPrompts.length > 0 && (
              <button
                onClick={() => setShowArchived((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition border border-white/10 rounded-lg px-3 py-2"
              >
                <Archive className="h-3.5 w-3.5" />
                {showArchived ? "Hide archived" : `Show archived (${archivedCreatedPrompts.length})`}
              </button>
            )}
          </div>
        </div>

        {/* Issue #500: Sticky Bulk Actions Bar */}
        {selectedPromptIds.size > 0 && (
          <div className="sticky top-4 z-40 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-slate-900/95 p-4 shadow-xl backdrop-blur-md transition-all">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                {selectedPromptIds.size}
              </span>
              <span className="text-sm font-medium text-slate-200">
                {selectedPromptIds.size} listing(s) selected
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="gap-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30"
                onClick={() => void executeBulkStatusChange(true, "Activate")}
                disabled={isBulkProcessing}
              >
                {isBulkProcessing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Bulk Activate
              </Button>

              <Button
                size="sm"
                className="gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30"
                onClick={() => void executeBulkStatusChange(false, "Pause")}
                disabled={isBulkProcessing}
              >
                {isBulkProcessing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Pause className="h-3.5 w-3.5" />
                )}
                Bulk Pause
              </Button>

              <Button
                size="sm"
                className="gap-1.5 bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30"
                onClick={() => setIsRetireModalOpen(true)}
                disabled={isBulkProcessing}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Bulk Retire
              </Button>

              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-slate-400 hover:text-slate-200"
                onClick={handleDeselectAll}
                disabled={isBulkProcessing}
              >
                Clear selection
              </Button>
            </div>
          </div>
        )}

        {/* Issue #500: Bulk Execution Results Box */}
        {bulkResults && (
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">
                Bulk {bulkResults.actionName} Results
              </h4>
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-400">
                  {bulkResults.successCount} Succeeded
                </span>
                {bulkResults.failureCount > 0 && (
                  <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-red-400">
                    {bulkResults.failureCount} Failed
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {bulkResults.details.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between rounded-xl p-2.5 text-xs ${
                    item.success
                      ? "bg-emerald-500/5 border border-emerald-500/20 text-emerald-200"
                      : "bg-red-500/5 border border-red-500/20 text-red-200"
                  }`}
                >
                  <span className="font-medium truncate max-w-[60%]">{item.title}</span>
                  <span>
                    {item.success ? (
                      <span className="text-emerald-400 font-semibold">Success</span>
                    ) : (
                      <span className="text-red-400 font-medium">{item.error || "Failed"}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Issue #500: Bulk Retire Confirmation Modal */}
        {isRetireModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="w-full max-w-md rounded-3xl border border-red-500/30 bg-slate-950 p-6 shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-red-400">
                <AlertTriangle className="h-6 w-6 shrink-0 text-red-500" />
                <h3 className="text-lg font-semibold text-white">Confirm Permanent Listing Retire</h3>
              </div>
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200 space-y-2">
                <p className="font-medium">
                  Warning: Retiring listings is an irreversible action on Stellar Soroban.
                </p>
                <p className="text-xs text-red-300/80 leading-relaxed">
                  You are about to retire <strong>{selectedPromptIds.size}</strong> listing(s). Once retired, buyers can no longer purchase licenses and you cannot reactivate or update these listings on-chain.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 border-white/10 text-slate-300 hover:bg-white/10"
                  onClick={() => setIsRetireModalOpen(false)}
                  disabled={isBulkProcessing}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-red-500 text-white hover:bg-red-600 font-semibold"
                  onClick={() => void handleConfirmBulkRetire()}
                  disabled={isBulkProcessing}
                >
                  {isBulkProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Confirm Retire
                </Button>
              </div>
            </div>
          </div>
        )}

        {createdQuery.isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-slate-300">
            Loading created prompts...
          </div>
        ) : activeCreatedPrompts.length === 0 && !showArchived ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-white/10 bg-white/5 px-8 py-14 text-center">
            <PackagePlus className="h-10 w-10 text-slate-500" />
            <div>
              <p className="text-base font-semibold text-white">No listings yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Publish your first prompt to start earning license fees.
              </p>
            </div>
            {onCreateNew && (
              <Button
                className="mt-2 bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                onClick={onCreateNew}
              >
                Create a listing
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Active prompts grid */}
            {activeCreatedPrompts.length > 0 && (
              <div className="grid gap-6 xl:grid-cols-2">
                {activeCreatedPrompts.map((prompt) => {
                  const isSelected = selectedPromptIds.has(prompt.id.toString());
                  return (
                    <Card
                      key={prompt.id.toString()}
                      className={`border-white/10 bg-slate-950/70 text-white transition-all ${
                        isSelected ? "ring-2 ring-emerald-500 border-emerald-500/50" : ""
                      }`}
                    >
                      <div className="relative aspect-video overflow-hidden rounded-t-xl">
                        <img
                          src={prompt.imageUrl || "/images/codeguru.png"}
                          alt={prompt.title}
                          className="h-full w-full object-cover"
                        />
                        {/* Selection Checkbox Overlay */}
                        <label
                          className="absolute top-3 left-3 z-10 flex cursor-pointer items-center gap-2 rounded-xl bg-slate-950/80 px-2.5 py-1.5 backdrop-blur-md border border-white/20 hover:border-emerald-400 transition"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectPrompt(prompt.id.toString())}
                            className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
                          />
                          <span className="text-xs font-semibold text-slate-200">
                            {isSelected ? "Selected" : "Select"}
                          </span>
                        </label>
                      </div>
                    <CardContent className="space-y-4 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                            {prompt.category}
                          </p>
                          <h3 className="mt-2 text-xl font-semibold">{prompt.title}</h3>
                          <p className="mt-3 text-sm leading-6 text-slate-300">
                            {prompt.previewText}
                          </p>
                        </div>
                        {/* Status badge */}
                        {prompt.active ? (
                          <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                            Active
                          </span>
                        ) : (
                          <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-500/25 bg-slate-500/10 px-2.5 py-1 text-xs font-semibold text-slate-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                            Sales
                          </p>
                          <p className="mt-2 font-medium text-slate-100">
                            {prompt.salesCount}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                            Current price
                          </p>
                          <p className="mt-2 font-medium text-slate-100">
                            {formatPriceLabel(prompt.priceStroops)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                            Revision
                          </p>
                          <p className="mt-2 font-medium text-slate-100">
                            {String((prompt as any).revision || 0)}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <Input
                          value={mergedDrafts[prompt.id.toString()]}
                          onChange={(event) =>
                            setPriceDrafts((current) => ({
                              ...current,
                              [prompt.id.toString()]: event.target.value,
                            }))
                          }
                          className="border-white/10 bg-white/5 text-slate-100"
                          aria-label={`Price in XLM for ${prompt.title}`}
                        />
                        <Button
                          className="bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                          onClick={() => void handleUpdatePrice(prompt.id)}
                          disabled={busyPromptId === prompt.id.toString()}
                        >
                          Update price
                        </Button>
                      </div>
                    </CardContent>
                    <CardFooter className="p-5 pt-0 flex flex-col gap-2">
                      <PostVersionUpdate
                        promptId={prompt.id.toString()}
                        promptTitle={prompt.title}
                        walletAddress={address ?? ""}
                        currentVersion={Number((prompt as any).revision || 0) + 1}
                      />
                      <Button
                        variant="outline"
                        className={`w-full gap-2 border-white/10 text-slate-100 hover:bg-white/10 ${
                          prompt.active
                            ? "bg-white/5 hover:border-red-400/30 hover:text-red-300"
                            : "bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-400/40 text-emerald-400"
                        }`}
                        onClick={() => void handleToggleSaleStatus(prompt.id, prompt.active)}
                        disabled={busyPromptId === prompt.id.toString()}
                      >
                        {busyPromptId === prompt.id.toString() ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : prompt.active ? (
                          <ToggleRight className="h-4 w-4" />
                        ) : (
                          <ToggleLeft className="h-4 w-4" />
                        )}
                        {prompt.active ? "Deactivate listing" : "Reactivate listing"}
                      </Button>
                      {/* #261 — Archive action */}
                      <Button
                        variant="outline"
                        className="w-full gap-2 border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-amber-300 hover:border-amber-400/30"
                        onClick={() => handleArchive(prompt.id.toString())}
                      >
                        <Archive className="h-4 w-4" />
                        Archive listing
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
              </div>
            )}

            {/* Archived prompts */}
            {showArchived && archivedCreatedPrompts.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-3">
                  Archived
                </p>
                <div className="grid gap-6 xl:grid-cols-2">
                  {archivedCreatedPrompts.map((prompt) => (
                    <Card
                      key={prompt.id.toString()}
                      className="border-white/10 bg-slate-950/40 text-white opacity-60 hover:opacity-80 transition-opacity"
                    >
                      <CardContent className="space-y-3 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs uppercase tracking-[0.25em] text-slate-600">
                              {prompt.category}
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-slate-300">{prompt.title}</h3>
                          </div>
                          <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-400">
                            <Archive className="h-3 w-3" />
                            Archived
                          </span>
                        </div>
                        <p className="text-sm text-slate-500 leading-relaxed">{prompt.previewText}</p>
                      </CardContent>
                      <CardFooter className="p-5 pt-0">
                        <Button
                          variant="outline"
                          className="w-full gap-2 border-amber-400/20 bg-amber-500/5 text-amber-300 hover:bg-amber-500/10 hover:border-amber-400/40"
                          onClick={() => handleRestore(prompt.id.toString())}
                        >
                          <ArchiveRestore className="h-4 w-4" />
                          Restore listing
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-white">Purchased by me</h2>
          <p className="mt-2 text-sm text-slate-400">
            Unlock purchased prompt text on demand. Access remains available for
            future sessions.
          </p>
        </div>

        {purchasedQuery.isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-slate-300">
            Loading purchased prompts...
          </div>
        ) : purchasedPrompts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-white/10 bg-white/5 px-8 py-14 text-center">
            <ShoppingBag className="h-10 w-10 text-slate-500" />
            <div>
              <p className="text-base font-semibold text-white">
                No purchases yet
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Browse the marketplace to find and unlock prompt licenses.
              </p>
            </div>
            <Button
              asChild
              className="mt-2 bg-white/10 text-slate-100 hover:bg-white/15"
            >
              <Link to="/browse">Browse marketplace</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            {purchasedPrompts.map((prompt) => (
              <Card
                key={prompt.id.toString()}
                className="border-white/10 bg-slate-950/70 text-white"
              >
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                        {prompt.category}
                      </p>
                      <h3 className="mt-2 text-xl font-semibold">
                        {prompt.title}
                      </h3>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm">
                      {formatPriceLabel(prompt.priceStroops)}
                    </div>
                  </div>
                  <p className="text-sm leading-6 text-slate-300">
                    {prompt.previewText}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      className="bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                      onClick={() => void handleUnlock(prompt.id)}
                      disabled={busyPromptId === prompt.id.toString()}
                    >
                      {busyPromptId === prompt.id.toString() ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Unlocking...
                        </>
                      ) : (
                        <>
                          <LockKeyhole className="mr-2 h-4 w-4" />
                          Unlock prompt
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                      onClick={() => void handleUnlock(prompt.id)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Re-open
                    </Button>
                  </div>
                  {unlockedPrompts[prompt.id.toString()] ? (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
                      <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-100">
                        {unlockedPrompts[prompt.id.toString()]}
                      </pre>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
                      Unlocked plaintext appears here after the access check
                      succeeds.
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default MyPrompts;