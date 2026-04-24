import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/hooks/useWallet";
import { invalidateAllPromptQueries } from "@/hooks/useContractSync";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import {
  getPromptsByBuyer,
  getPromptsByCreator,
  setPromptSaleStatus,
  updatePromptPrice,
} from "@/lib/stellar/promptHashClient";
import { formatPriceLabel, stroopsToXlmString, xlmToStroops } from "@/lib/stellar/format";
import { unlockPromptContent } from "@/lib/prompts/unlock";

const emptyState = (
  <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-slate-300">
    No prompts found yet.
  </div>
);

const MyPrompts = () => {
  const queryClient = useQueryClient();
  const { address, signMessage, signTransaction } = useWallet();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [unlockedPrompts, setUnlockedPrompts] = useState<Record<string, string>>({});

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

  const mergedDrafts = useMemo(() => {
    return Object.fromEntries(
      createdPrompts.map((prompt) => [
        prompt.id.toString(),
        priceDrafts[prompt.id.toString()] ?? stroopsToXlmString(prompt.priceStroops),
      ]),
    );
  }, [createdPrompts, priceDrafts]);

  const refreshPromptLists = () => invalidateAllPromptQueries(queryClient);

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
        promptId,
        !active,
      );
      updateStatus(!active ? "Prompt reactivated." : "Prompt deactivated.");
      await refreshPromptLists();
    } catch (error) {
      updateError(error instanceof Error ? error.message : "Failed to update sale status.");
    } finally {
      setBusyPromptId(null);
    }
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
        promptId,
        nextPrice,
      );
      updateStatus("Prompt price updated.");
      await refreshPromptLists();
    } catch (error) {
      updateError(error instanceof Error ? error.message : "Failed to update price.");
    } finally {
      setBusyPromptId(null);
    }
  };

  const handleUnlock = async (promptId: bigint) => {
    if (!address || !signMessage) {
      updateError("Connect a wallet with SEP-43 message signing to unlock prompts.");
      return;
    }

    setBusyPromptId(promptId.toString());
    try {
      const response = await unlockPromptContent(address, promptId, signMessage);
      setUnlockedPrompts((current) => ({
        ...current,
        [promptId.toString()]: response.plaintext,
      }));
      updateStatus("Prompt unlocked.");
    } catch (error) {
      updateError(error instanceof Error ? error.message : "Failed to unlock prompt.");
    } finally {
      setBusyPromptId(null);
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
          <h2 className="text-2xl font-semibold text-white">Created by me</h2>
          <p className="mt-2 text-sm text-slate-400">
            Update pricing, pause listings, and track license sales without changing ownership.
          </p>
        </div>

        {createdQuery.isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-slate-300">
            Loading created prompts...
          </div>
        ) : createdPrompts.length === 0 ? (
          emptyState
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            {createdPrompts.map((prompt) => (
              <Card
                key={prompt.id.toString()}
                className="border-white/10 bg-slate-950/70 text-white"
              >
                <div className="aspect-video overflow-hidden rounded-t-xl">
                  <img
                    src={prompt.imageUrl || "/images/codeguru.png"}
                    alt={prompt.title}
                    className="h-full w-full object-cover"
                  />
                </div>
                <CardContent className="space-y-4 p-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                      {prompt.category}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold">{prompt.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {prompt.previewText}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
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
                        Status
                      </p>
                      <p className="mt-2 font-medium text-slate-100">
                        {prompt.active ? "Active" : "Inactive"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
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
                      className="bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                      onClick={() => void handleUpdatePrice(prompt.id)}
                      disabled={busyPromptId === prompt.id.toString()}
                    >
                      Update price
                    </Button>
                  </div>
                </CardContent>
                <CardFooter className="flex items-center justify-between p-5 pt-0">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Current price
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-100">
                      {formatPriceLabel(prompt.priceStroops)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                    onClick={() => void handleToggleSaleStatus(prompt.id, prompt.active)}
                    disabled={busyPromptId === prompt.id.toString()}
                  >
                    {prompt.active ? "Set inactive" : "Reactivate"}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-white">Purchased by me</h2>
          <p className="mt-2 text-sm text-slate-400">
            Unlock purchased prompt text on demand. Access remains available for future sessions.
          </p>
        </div>

        {purchasedQuery.isLoading ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-slate-300">
            Loading purchased prompts...
          </div>
        ) : purchasedPrompts.length === 0 ? (
          emptyState
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
                      <h3 className="mt-2 text-xl font-semibold">{prompt.title}</h3>
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
                      Unlocked plaintext appears here after the access check succeeds.
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
