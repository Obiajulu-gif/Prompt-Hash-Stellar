import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Loader2,
  LockKeyhole,
  PlusCircle,
  TrendingUp,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/hooks/useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import {
  getPromptsByBuyer,
  getPromptsByCreator,
  setPromptSaleStatus,
  updatePromptPrice,
} from "@/lib/stellar/promptHashClient";
import {
  formatPriceLabel,
  stroopsToXlmString,
  xlmToStroops,
} from "@/lib/stellar/format";
import { unlockPromptContent } from "@/lib/prompts/unlock";

interface Props {
  onCreateNew?: () => void;
}

// ── Skeleton loader ───────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="aspect-video rounded-xl bg-white/10" />
      <div className="mt-4 space-y-2">
        <div className="h-3 w-1/3 rounded bg-white/10" />
        <div className="h-5 w-2/3 rounded bg-white/10" />
        <div className="h-3 w-full rounded bg-white/10" />
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({
  label,
  action,
}: {
  label: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[2rem] border border-dashed border-white/10 bg-white/5 px-8 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
        <TrendingUp className="h-5 w-5 text-slate-500" />
      </div>
      <p className="text-sm text-slate-400">{label}</p>
      {action}
    </div>
  );
}

// ── Toast-style feedback ──────────────────────────────────────────────────────
function Feedback({
  status,
  error,
}: {
  status: string | null;
  error: string | null;
}) {
  if (!status && !error) return null;
  if (status)
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
        {status}
      </div>
    );
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
      {error}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const MyPrompts = ({ onCreateNew }: Props) => {
  const queryClient = useQueryClient();
  const { address, signMessage, signTransaction } = useWallet();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [unlockedPrompts, setUnlockedPrompts] = useState<
    Record<string, string>
  >({});

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

  const mergedDrafts = useMemo(
    () =>
      Object.fromEntries(
        createdPrompts.map((p) => [
          p.id.toString(),
          priceDrafts[p.id.toString()] ?? stroopsToXlmString(p.priceStroops),
        ]),
      ),
    [createdPrompts, priceDrafts],
  );

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["created-prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["purchased-prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["marketplace-prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["prompt-access"] }),
    ]);
  };

  const ok = (msg: string) => {
    setErrorMessage(null);
    setStatusMessage(msg);
  };
  const err = (msg: string) => {
    setStatusMessage(null);
    setErrorMessage(msg);
  };

  const handleToggleSaleStatus = async (promptId: bigint, active: boolean) => {
    if (!address || !signTransaction) {
      err("Connect a wallet before changing prompt status.");
      return;
    }
    setBusyPromptId(promptId.toString());
    try {
      await setPromptSaleStatus(
        browserStellarConfig,
        { signTransaction },
        address,
        promptId,
        !active,
      );
      ok(!active ? "Listing reactivated." : "Listing paused.");
      await refreshAll();
    } catch (e) {
      err(e instanceof Error ? e.message : "Failed to update sale status.");
    } finally {
      setBusyPromptId(null);
    }
  };

  const handleUpdatePrice = async (promptId: bigint) => {
    if (!address || !signTransaction) {
      err("Connect a wallet before updating prices.");
      return;
    }
    setBusyPromptId(promptId.toString());
    try {
      const nextPrice = xlmToStroops(mergedDrafts[promptId.toString()]);
      await updatePromptPrice(
        browserStellarConfig,
        { signTransaction },
        address,
        promptId,
        nextPrice,
      );
      ok("Price updated.");
      await refreshAll();
    } catch (e) {
      err(e instanceof Error ? e.message : "Failed to update price.");
    } finally {
      setBusyPromptId(null);
    }
  };

  const handleUnlock = async (promptId: bigint) => {
    if (!address || !signMessage) {
      err("Connect a wallet with SEP-43 message signing to unlock prompts.");
      return;
    }
    setBusyPromptId(promptId.toString());
    try {
      const response = await unlockPromptContent(
        address,
        promptId,
        signMessage,
      );
      setUnlockedPrompts((prev) => ({
        ...prev,
        [promptId.toString()]: response.plaintext,
      }));
      ok("Prompt unlocked.");
    } catch (e) {
      err(e instanceof Error ? e.message : "Failed to unlock prompt.");
    } finally {
      setBusyPromptId(null);
    }
  };

  // ── Not connected ───────────────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-[2rem] border border-white/10 bg-slate-950/60 px-8 py-14 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
          <LockKeyhole className="h-5 w-5 text-slate-500" />
        </div>
        <div>
          <p className="font-medium text-slate-200">Wallet not connected</p>
          <p className="mt-1 text-sm text-slate-400">
            Connect your Stellar wallet to manage your listings and view
            purchased prompts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <Feedback status={statusMessage} error={errorMessage} />

      {/* ── Created by me ── */}
      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">
              Created by me
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Update pricing, pause listings, and track license sales.
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0 gap-1.5 bg-emerald-400 text-slate-950 hover:bg-emerald-300"
            onClick={onCreateNew}
          >
            <PlusCircle className="h-3.5 w-3.5" />
            New listing
          </Button>
        </div>

        {createdQuery.isLoading ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : createdPrompts.length === 0 ? (
          <EmptyState
            label="You haven't created any listings yet."
            action={
              <Button
                size="sm"
                className="gap-1.5 bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                onClick={onCreateNew}
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Create your first listing
              </Button>
            }
          />
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {createdPrompts.map((prompt) => {
              const busy = busyPromptId === prompt.id.toString();
              return (
                <Card
                  key={prompt.id.toString()}
                  className="overflow-hidden border-white/10 bg-slate-950/70 text-white"
                >
                  {/* Cover */}
                  <div className="aspect-video overflow-hidden">
                    <img
                      src={prompt.imageUrl || "/images/codeguru.png"}
                      alt={prompt.title}
                      className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                    />
                  </div>

                  <CardContent className="space-y-4 p-5">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-widest text-slate-500">
                          {prompt.category}
                        </p>
                        <h3 className="mt-1 truncate text-base font-semibold">
                          {prompt.title}
                        </h3>
                      </div>
                      <Badge
                        className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          prompt.active
                            ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
                            : "border-white/10 bg-white/5 text-slate-400"
                        }`}
                      >
                        {prompt.active ? "Active" : "Paused"}
                      </Badge>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-slate-500">
                          Sales
                        </p>
                        <p className="mt-1 font-semibold text-slate-100">
                          {prompt.salesCount}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-widest text-slate-500">
                          Current price
                        </p>
                        <p className="mt-1 font-semibold text-slate-100">
                          {formatPriceLabel(prompt.priceStroops)}
                        </p>
                      </div>
                    </div>

                    {/* Price update */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-400">
                        Update price (XLM)
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            value={mergedDrafts[prompt.id.toString()]}
                            onChange={(e) =>
                              setPriceDrafts((prev) => ({
                                ...prev,
                                [prompt.id.toString()]: e.target.value,
                              }))
                            }
                            className="border-white/10 bg-white/5 pr-12 text-slate-100"
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                            XLM
                          </span>
                        </div>
                        <Button
                          size="sm"
                          className="shrink-0 bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                          onClick={() => void handleUpdatePrice(prompt.id)}
                          disabled={busy}
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Toggle active */}
                    <button
                      className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm transition-colors hover:bg-white/10 disabled:opacity-50"
                      onClick={() =>
                        void handleToggleSaleStatus(
                          prompt.id,
                          prompt.active,
                        )
                      }
                      disabled={busy}
                    >
                      <span className="text-slate-300">
                        {prompt.active
                          ? "Pause this listing"
                          : "Reactivate listing"}
                      </span>
                      {prompt.active ? (
                        <ToggleRight className="h-5 w-5 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="h-5 w-5 text-slate-500" />
                      )}
                    </button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Purchased by me ── */}
      <section className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-white">Purchased by me</h2>
          <p className="mt-1 text-sm text-slate-400">
            Unlock purchased prompt text on demand. Access is permanent once
            granted on-chain.
          </p>
        </div>

        {purchasedQuery.isLoading ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <SkeletonCard />
          </div>
        ) : purchasedPrompts.length === 0 ? (
          <EmptyState label="You haven't purchased any prompts yet." />
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {purchasedPrompts.map((prompt) => {
              const busy = busyPromptId === prompt.id.toString();
              const unlocked = unlockedPrompts[prompt.id.toString()];
              return (
                <Card
                  key={prompt.id.toString()}
                  className="overflow-hidden border-white/10 bg-slate-950/70 text-white"
                >
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-widest text-slate-500">
                          {prompt.category}
                        </p>
                        <h3 className="mt-1 truncate text-base font-semibold">
                          {prompt.title}
                        </h3>
                      </div>
                      <div className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
                        {formatPriceLabel(prompt.priceStroops)}
                      </div>
                    </div>

                    <p className="text-sm leading-6 text-slate-400">
                      {prompt.previewText}
                    </p>

                    {/* Unlocked content */}
                    {unlocked ? (
                      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Unlocked
                        </div>
                        <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-100">
                          {unlocked}
                        </pre>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-500">
                        <LockKeyhole className="h-3.5 w-3.5 shrink-0" />
                        Unlock to reveal the full prompt text.
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="flex-1 bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                        onClick={() => void handleUnlock(prompt.id)}
                        disabled={busy}
                      >
                        {busy ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Unlocking…
                          </>
                        ) : (
                          <>
                            <LockKeyhole className="mr-2 h-4 w-4" />
                            {unlocked ? "Re-unlock" : "Unlock prompt"}
                          </>
                        )}
                      </Button>
                      {unlocked && (
                        <Button
                          variant="outline"
                          className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                          onClick={() => void handleUnlock(prompt.id)}
                          disabled={busy}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Refresh
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default MyPrompts;
