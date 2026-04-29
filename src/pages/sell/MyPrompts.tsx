import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, LockKeyhole, AlertCircle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/hooks/useWallet";
import { invalidateAllPromptQueries } from "@/hooks/useContractSync";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import {
  setPromptSaleStatus,
  updatePromptPrice,
} from "@/lib/stellar/promptHashClient";
import {
  formatPriceLabel,
  stroopsToXlmString,
  xlmToStroops,
} from "@/lib/stellar/format";
import { unlockPromptContent } from "@/lib/prompts/unlock";
import { useDashboard } from "@/hooks/useDashboard";

const EmptyState = ({ message }: { message: string }) => (
  <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/5 p-12 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-slate-500 mb-4">
      <AlertCircle size={24} />
    </div>
    <p className="text-sm text-slate-400">{message}</p>
  </div>
);

const LoadingState = ({ message }: { message: string }) => (
  <div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/5 p-12 text-center">
    <Loader2 className="h-8 w-8 animate-spin text-emerald-400 mb-4" />
    <p className="text-sm text-slate-400">{message}</p>
  </div>
);

const ErrorState = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <div className="flex flex-col items-center justify-center rounded-3xl border border-red-500/20 bg-red-500/5 p-12 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20 text-red-400 mb-4">
      <AlertCircle size={24} />
    </div>
    <p className="text-sm text-red-200 mb-6">{message}</p>
    <Button 
      variant="outline" 
      onClick={onRetry}
      className="border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/20"
    >
      <RefreshCcw className="mr-2 h-4 w-4" />
      Retry
    </Button>
  </div>
);

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
  const { signMessage, signTransaction } = useWallet();
  const { address, created, purchased, refresh } = useDashboard();
  
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [unlockedPrompts, setUnlockedPrompts] = useState<
    Record<string, string>
  >({});

  const mergedDrafts = useMemo(() => {
    return Object.fromEntries(
      created.data.map((prompt) => [
        prompt.id.toString(),
        priceDrafts[prompt.id.toString()] ?? stroopsToXlmString(prompt.priceStroops),
      ]),
    );
  }, [created.data, priceDrafts]);

  const refreshPromptLists = async () => {
    await refresh();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["marketplace-prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["prompt-access"] }),
    ]);
  };
  const refreshPromptLists = () => invalidateAllPromptQueries(queryClient);

  const ok = (msg: string) => {
    setErrorMessage(null);
    setStatusMessage(message);
    setTimeout(() => setStatusMessage(null), 5000);
  };
  const err = (msg: string) => {
    setStatusMessage(null);
    setErrorMessage(message);
    setTimeout(() => setErrorMessage(null), 5000);
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
      <EmptyState message="Connect your Stellar wallet to manage created and purchased prompts." />
    );
  }

  return (
    <div className="space-y-12">
      {statusMessage ? (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 rounded-2xl border border-emerald-400/20 bg-slate-900/90 px-6 py-4 text-sm text-emerald-400 shadow-2xl backdrop-blur-md">
          {statusMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 rounded-2xl border border-red-400/20 bg-slate-900/90 px-6 py-4 text-sm text-red-400 shadow-2xl backdrop-blur-md">
          {errorMessage}
        </div>
      ) : null}

      <section className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">Created by me</h2>
            <p className="mt-2 text-sm text-slate-400">
              Update pricing, pause listings, and track license sales without changing ownership.
            </p>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => refresh()} 
            className="text-slate-400 hover:text-white"
            disabled={created.isLoading}
          >
            <RefreshCcw className={`mr-2 h-4 w-4 ${created.isLoading ? 'animate-spin' : ''}`} />
            Sync
          </Button>
        </div>

        {created.isLoading ? (
          <LoadingState message="Fetching your created listings..." />
        ) : created.isError ? (
          <ErrorState 
            message={created.error instanceof Error ? created.error.message : "Failed to load created prompts."} 
            onRetry={() => refresh()}
          />
        ) : created.data.length === 0 ? (
          <EmptyState message="You haven't created any prompts yet." />
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            {created.data.map((prompt) => (
              <Card
                key={prompt.id.toString()}
                className="overflow-hidden border-white/10 bg-slate-950/70 text-white transition-all hover:border-emerald-500/30"
              >
                <div className="aspect-video overflow-hidden">
                  <img
                    src={prompt.imageUrl || "/images/codeguru.png"}
                    alt={prompt.title}
                    className="h-full w-full object-cover transition-transform hover:scale-105"
                  />
                </div>
                <CardContent className="space-y-4 p-6">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-400 font-bold">
                      {prompt.category}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold">{prompt.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-400 line-clamp-2">
                      {prompt.previewText}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 rounded-2xl border border-white/5 bg-white/5 p-4 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold">
                        Sales
                      </p>
                      <p className="mt-1 font-semibold text-slate-100 text-lg">
                        {prompt.salesCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold">
                        Status
                      </p>
                      <p className={`mt-1 font-semibold text-lg ${prompt.active ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {prompt.active ? "Active" : "Inactive"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <Input
                        value={mergedDrafts[prompt.id.toString()]}
                        onChange={(event) =>
                          setPriceDrafts((current) => ({
                            ...current,
                            [prompt.id.toString()]: event.target.value,
                          }))
                        }
                        className="border-white/10 bg-white/5 text-slate-100 pr-12 focus-visible:ring-emerald-500/50"
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-bold">
                        XLM
                      </div>
                    </div>
                    <Input
                      aria-label={`Price for ${prompt.title}`}
                      value={mergedDrafts[prompt.id.toString()]}
                      onChange={(event) =>
                        setPriceDrafts((current) => ({
                          ...current,
                          [prompt.id.toString()]: event.target.value,
                        }))
                      }
                      className="border-white/10 bg-white/5 text-slate-100"
                    />
                    <Button
                      className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                      onClick={() => void handleUpdatePrice(prompt.id)}
                      disabled={busyPromptId === prompt.id.toString()}
                    >
                      {busyPromptId === prompt.id.toString() ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Update"
                      )}
                    </Button>
                  </div>
                </CardContent>
                <CardFooter className="flex items-center justify-between p-6 pt-0">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold">
                      Price
                    </p>
                    <p className="mt-1 text-lg font-bold text-slate-100">
                      {formatPriceLabel(prompt.priceStroops)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                    onClick={() => void handleToggleSaleStatus(prompt.id, prompt.active)}
                    disabled={busyPromptId === prompt.id.toString()}
                  >
                    {prompt.active ? "Pause listing" : "Reactivate"}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">Purchased by me</h2>
            <p className="mt-2 text-sm text-slate-400">
              Unlock purchased prompt text on demand. Access remains available for future sessions.
            </p>
          </div>
        </div>

        {purchased.isLoading ? (
          <LoadingState message="Fetching your purchased prompts..." />
        ) : purchased.isError ? (
          <ErrorState 
            message={purchased.error instanceof Error ? purchased.error.message : "Failed to load purchased prompts."} 
            onRetry={() => refresh()}
          />
        ) : purchased.data.length === 0 ? (
          <EmptyState message="You haven't purchased any prompts yet." />
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            {purchased.data.map((prompt) => (
              <Card
                key={prompt.id.toString()}
                className="border-white/10 bg-slate-950/70 text-white transition-all hover:border-emerald-500/30"
              >
                <CardContent className="space-y-4 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-400 font-bold">
                        {prompt.category}
                      </p>
                      <h3 className="mt-2 text-xl font-semibold">{prompt.title}</h3>
                    </div>
                    <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-400">
                      {formatPriceLabel(prompt.priceStroops)}
                    </div>
                  </div>
                  <p className="text-sm leading-6 text-slate-400">
                    {prompt.previewText}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"
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
                      className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                      onClick={() => void handleUnlock(prompt.id)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Re-open
                    </Button>
                  </div>
                  {unlockedPrompts[prompt.id.toString()] ? (
                    <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-slate-900/50 p-6 shadow-inner">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-widest text-emerald-500 font-bold">Decrypted Content</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 px-2 text-[10px] text-slate-500 hover:text-white"
                          onClick={() => {
                            void navigator.clipboard.writeText(unlockedPrompts[prompt.id.toString()]);
                            updateStatus("Copied to clipboard.");
                          }}
                        >
                          Copy
                        </Button>
                      </div>
                      <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-100">
                        {unlockedPrompts[prompt.id.toString()]}
                      </pre>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/5 bg-white/5 px-6 py-8 text-center">
                      <LockKeyhole className="mx-auto h-6 w-6 text-slate-600 mb-2" />
                      <p className="text-xs text-slate-500">
                        Unlocked plaintext appears here after the access check succeeds.
                      </p>
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
