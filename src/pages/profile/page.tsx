import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgeCheck,
  BookOpenCheck,
  Boxes,
  CheckCircle2,
  CircleOff,
  Copy,
  Eye,
  KeyRound,
  LibraryBig,
  Loader2,
  LockKeyhole,
  PanelTopOpen,
  PauseCircle,
  PencilLine,
  PlugZap,
  RadioTower,
  ShieldCheck,
  ShoppingBag,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Footer } from "@/components/footer";
import { Navigation } from "@/components/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/hooks/useWallet";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { invalidateAllPromptQueries } from "@/hooks/useContractSync";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import {
  getPromptsByBuyer,
  getPromptsByCreator,
  setPromptSaleStatus,
  updatePromptPrice,
  type PromptRecord,
} from "@/lib/stellar/promptHashClient";
import {
  formatPriceLabel,
  stroopsToXlmString,
  xlmToStroops,
} from "@/lib/stellar/format";
import { unlockPromptContent } from "@/lib/prompts/unlock";
import { shortenAddress } from "@/lib/utils";
import { stellarNetwork } from "@/lib/env";
import { connectWallet } from "@/util/wallet";

const promptImageFallback = "/images/codeguru.png";

const formatNetworkName = (value?: string) => {
  if (!value) return "Not connected";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
};

const shortHash = (value: string) =>
  value ? `${value.slice(0, 8)}...${value.slice(-8)}` : "Pending";

const statusBadgeClass = (isActive: boolean) =>
  isActive
    ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
    : "border-amber-300/30 bg-amber-300/10 text-amber-100";

// eslint-disable-next-line no-unused-vars
type Handler<TArgs extends unknown[]> = (...args: TArgs) => void;

function AlertBanner({
  tone,
  message,
}: {
  tone: "success" | "error";
  message: string;
}) {
  return (
    <div
      className={
        tone === "success"
          ? "rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100"
          : "rounded-lg border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100"
      }
    >
      {message}
    </div>
  );
}

function MetricTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
          {label}
        </p>
        <Icon className="h-4 w-4 text-cyan-200" />
      </div>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function DisconnectedProfile() {
  return (
    <section className="grid gap-6 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-stretch">
      <div className="rounded-lg border border-white/10 bg-[#101417] p-6 shadow-[0_28px_80px_-54px_rgba(45,212,191,0.7)] md:p-8">
        <Badge className="border-cyan-200/30 bg-cyan-200/10 text-cyan-100">
          Wallet required
        </Badge>
        <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-white md:text-5xl">
          Your prompt library starts with a Stellar wallet.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
          Connect to see licensed prompts you can reopen, creator inventory you
          control, and listing states tied to your wallet identity.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button
            className="bg-cyan-200 text-slate-950 hover:bg-cyan-100"
            onClick={() => void connectWallet()}
          >
            <PlugZap className="h-4 w-4" />
            Connect wallet
          </Button>
          <Button
            asChild
            variant="outline"
            className="border-white/15 bg-white/[0.03] text-white hover:bg-white/10"
          >
            <Link to="/browse">
              <ShoppingBag className="h-4 w-4" />
              Browse prompts
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.035] p-5">
        {[
          {
            icon: KeyRound,
            title: "Purchased licenses",
            body: "Unlocked access is grouped separately from creator listings.",
          },
          {
            icon: Boxes,
            title: "Creator inventory",
            body: "Pricing, sales count, and listing status stay in their own lane.",
          },
          {
            icon: ShieldCheck,
            title: "Wallet-authenticated re-entry",
            body: "Full prompt text appears only after the wallet signs an unlock request.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="grid grid-cols-[2.5rem_1fr] gap-4 rounded-lg bg-slate-950/45 p-4"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-200/10 text-cyan-100">
              <item.icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-medium text-white">{item.title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">{item.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function WalletIdentityPanel({
  address,
  network,
  balanceLabel,
  isBalanceLoading,
  purchasedCount,
  createdCount,
  activeCount,
}: {
  address: string;
  network?: string;
  balanceLabel: string;
  isBalanceLoading: boolean;
  purchasedCount: number;
  createdCount: number;
  activeCount: number;
}) {
  return (
    <section className="grid gap-6 py-8 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="rounded-lg border border-white/10 bg-[#101417] p-6 shadow-[0_28px_80px_-54px_rgba(56,189,248,0.65)] md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="border-cyan-200/30 bg-cyan-200/10 text-cyan-100">
            Wallet profile
          </Badge>
          <Badge className="border-white/10 bg-white/[0.04] text-slate-200">
            <RadioTower className="mr-1 h-3.5 w-3.5" />
            {formatNetworkName(network ?? stellarNetwork)}
          </Badge>
        </div>

        <div className="mt-7 grid gap-5 lg:grid-cols-[auto_1fr] lg:items-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-cyan-200/20 bg-cyan-200/10 text-cyan-100">
            <Wallet className="h-9 w-9" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-slate-400">Connected identity</p>
            <h1 className="mt-2 text-3xl font-semibold text-white md:text-5xl">
              {shortenAddress(address)}
            </h1>
            <div className="mt-4 flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
              <Copy className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
              <span className="min-w-0 truncate font-mono">{address}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <MetricTile
          icon={BadgeCheck}
          label="Owned licenses"
          value={purchasedCount}
        />
        <MetricTile icon={PanelTopOpen} label="Created prompts" value={createdCount} />
        <MetricTile icon={CheckCircle2} label="Active listings" value={activeCount} />
        <MetricTile
          icon={Wallet}
          label="Wallet balance"
          value={isBalanceLoading ? "Loading" : `${balanceLabel} XLM`}
        />
      </div>
    </section>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-56 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] p-8 text-sm text-slate-300">
      <Loader2 className="mr-2 h-4 w-4 animate-spin text-cyan-200" />
      {label}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action: { label: string; to: string; icon: LucideIcon };
}) {
  const ActionIcon = action.icon;

  return (
    <div className="grid min-h-72 place-items-center rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-cyan-200/10 text-cyan-100">
          <Icon className="h-7 w-7" />
        </div>
        <h3 className="mt-5 text-xl font-semibold text-white">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-slate-400">{body}</p>
        <Button
          asChild
          className="mt-6 bg-cyan-200 text-slate-950 hover:bg-cyan-100"
        >
          <Link to={action.to}>
            <ActionIcon className="h-4 w-4" />
            {action.label}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function PurchasedPromptCard({
  prompt,
  isBusy,
  plaintext,
  onUnlock,
}: {
  prompt: PromptRecord;
  isBusy: boolean;
  plaintext?: string;
  onUnlock: Handler<[bigint]>;
}) {
  const isUnlocked = Boolean(plaintext);

  return (
    <article className="grid overflow-hidden rounded-lg border border-white/10 bg-[#11161a] md:grid-cols-[15rem_1fr]">
      <img
        src={prompt.imageUrl || promptImageFallback}
        alt={prompt.title}
        className="h-52 w-full object-cover md:h-full"
      />
      <div className="min-w-0 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-cyan-200/30 bg-cyan-200/10 text-cyan-100">
            <BookOpenCheck className="mr-1 h-3.5 w-3.5" />
            License owned
          </Badge>
          <Badge className="border-white/10 bg-white/[0.04] text-slate-300">
            {prompt.category}
          </Badge>
          <Badge
            className={
              isUnlocked
                ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                : "border-amber-300/30 bg-amber-300/10 text-amber-100"
            }
          >
            {isUnlocked ? "Unlocked now" : "Wallet unlock needed"}
          </Badge>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <h3 className="text-2xl font-semibold text-white">{prompt.title}</h3>
            <p className="mt-3 line-clamp-3 text-sm leading-7 text-slate-300">
              {prompt.previewText}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm lg:min-w-40">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Paid access
            </p>
            <p className="mt-2 font-semibold text-white">
              {formatPriceLabel(prompt.priceStroops)}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            className="bg-cyan-200 text-slate-950 hover:bg-cyan-100"
            onClick={() => onUnlock(prompt.id)}
            disabled={isBusy}
          >
            {isBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Unlocking
              </>
            ) : (
              <>
                {isUnlocked ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <LockKeyhole className="h-4 w-4" />
                )}
                {isUnlocked ? "Re-open prompt" : "Unlock full prompt"}
              </>
            )}
          </Button>
          <p className="text-xs text-slate-500">
            Hash {shortHash(prompt.contentHash)}
          </p>
        </div>

        {plaintext ? (
          <div className="mt-5 rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-emerald-100">
              <ShieldCheck className="h-4 w-4" />
              Unlocked content
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-7 text-slate-100">
              {plaintext}
            </pre>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function CreatedPromptCard({
  prompt,
  isBusy,
  priceDraft,
  onDraftChange,
  onUpdatePrice,
  onToggleStatus,
}: {
  prompt: PromptRecord;
  isBusy: boolean;
  priceDraft: string;
  onDraftChange: Handler<[string]>;
  onUpdatePrice: Handler<[bigint]>;
  onToggleStatus: Handler<[bigint, boolean]>;
}) {
  return (
    <article className="rounded-lg border border-white/10 bg-[#11161a] p-5">
      <div className="grid gap-5 lg:grid-cols-[10rem_1fr]">
        <img
          src={prompt.imageUrl || promptImageFallback}
          alt={prompt.title}
          className="aspect-video w-full rounded-lg object-cover lg:aspect-square"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={statusBadgeClass(prompt.active)}>
              {prompt.active ? (
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              ) : (
                <PauseCircle className="mr-1 h-3.5 w-3.5" />
              )}
              {prompt.active ? "Active listing" : "Paused listing"}
            </Badge>
            <Badge className="border-white/10 bg-white/[0.04] text-slate-300">
              {prompt.category}
            </Badge>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <h3 className="text-2xl font-semibold text-white">{prompt.title}</h3>
              <p className="mt-3 line-clamp-3 text-sm leading-7 text-slate-300">
                {prompt.previewText}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm xl:w-72">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Sales
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {prompt.salesCount}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Price
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {formatPriceLabel(prompt.priceStroops)}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,14rem)_auto_auto] md:items-center">
            <Input
              value={priceDraft}
              onChange={(event) => onDraftChange(event.target.value)}
              className="h-10 border-white/10 bg-white/[0.04] text-slate-100"
              aria-label={`Price in XLM for ${prompt.title}`}
            />
            <Button
              className="bg-cyan-200 text-slate-950 hover:bg-cyan-100"
              onClick={() => onUpdatePrice(prompt.id)}
              disabled={isBusy}
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PencilLine className="h-4 w-4" />
              )}
              Update price
            </Button>
            <Button
              variant="outline"
              className="border-white/15 bg-white/[0.03] text-white hover:bg-white/10"
              onClick={() => onToggleStatus(prompt.id, prompt.active)}
              disabled={isBusy}
            >
              {prompt.active ? (
                <CircleOff className="h-4 w-4" />
              ) : (
                <ArrowUpRight className="h-4 w-4" />
              )}
              {prompt.active ? "Pause listing" : "Reactivate"}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const { address, network, signMessage, signTransaction } = useWallet();
  const { xlm, isLoading: isBalanceLoading } = useWalletBalance();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [unlockedPrompts, setUnlockedPrompts] = useState<Record<string, string>>(
    {},
  );

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
  const activeListingCount = createdPrompts.filter((prompt) => prompt.active).length;

  const mergedDrafts = useMemo(() => {
    return Object.fromEntries(
      createdPrompts.map((prompt) => [
        prompt.id.toString(),
        priceDrafts[prompt.id.toString()] ??
          stroopsToXlmString(prompt.priceStroops),
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
      updateStatus(!active ? "Prompt listing reactivated." : "Prompt listing paused.");
      await refreshPromptLists();
    } catch (error) {
      updateError(
        error instanceof Error ? error.message : "Failed to update listing status.",
      );
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
      updateStatus("Prompt unlocked. You can re-open it from this library.");
    } catch (error) {
      updateError(error instanceof Error ? error.message : "Failed to unlock prompt.");
    } finally {
      setBusyPromptId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_15%_0%,rgba(45,212,191,0.18),transparent_30%),radial-gradient(circle_at_88%_12%,rgba(245,158,11,0.12),transparent_28%),linear-gradient(180deg,#090c0f_0%,#111827_46%,#080b0f_100%)] text-white">
      <Navigation />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
        {!address ? (
          <DisconnectedProfile />
        ) : (
          <>
            <WalletIdentityPanel
              address={address}
              network={network}
              balanceLabel={xlm}
              isBalanceLoading={isBalanceLoading}
              purchasedCount={purchasedPrompts.length}
              createdCount={createdPrompts.length}
              activeCount={activeListingCount}
            />

            <div className="space-y-3">
              {statusMessage ? (
                <AlertBanner tone="success" message={statusMessage} />
              ) : null}
              {errorMessage ? (
                <AlertBanner tone="error" message={errorMessage} />
              ) : null}
            </div>

            <section className="mt-8">
              <Tabs defaultValue="purchased" className="space-y-5">
                <div className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-[0.24em] text-cyan-200">
                      Prompt access
                    </p>
                    <h2 className="mt-2 text-3xl font-semibold text-white">
                      Library and inventory
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                      Purchased prompts are optimized for re-entry and unlock.
                      Created prompts stay focused on listing control.
                    </p>
                  </div>
                  <TabsList className="grid h-auto w-full grid-cols-2 rounded-lg border border-white/10 bg-white/[0.04] p-1 lg:w-[28rem]">
                    <TabsTrigger
                      value="purchased"
                      className="rounded-md px-3 py-2 text-slate-300 data-[state=active]:bg-cyan-200 data-[state=active]:text-slate-950"
                    >
                      Purchased
                      <span className="ml-2 rounded bg-slate-950/10 px-1.5 py-0.5 text-xs">
                        {purchasedPrompts.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="created"
                      className="rounded-md px-3 py-2 text-slate-300 data-[state=active]:bg-cyan-200 data-[state=active]:text-slate-950"
                    >
                      Created
                      <span className="ml-2 rounded bg-slate-950/10 px-1.5 py-0.5 text-xs">
                        {createdPrompts.length}
                      </span>
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="purchased" className="mt-0 space-y-4">
                  {purchasedQuery.isLoading ? (
                    <LoadingState label="Loading purchased prompt licenses..." />
                  ) : purchasedPrompts.length === 0 ? (
                    <EmptyState
                      icon={LibraryBig}
                      title="No purchased prompts yet"
                      body="When this wallet buys access, prompts appear here with a direct unlock path back to the protected content."
                      action={{
                        label: "Browse marketplace",
                        to: "/browse",
                        icon: ShoppingBag,
                      }}
                    />
                  ) : (
                    <div className="space-y-4">
                      {purchasedPrompts.map((prompt) => (
                        <PurchasedPromptCard
                          key={prompt.id.toString()}
                          prompt={prompt}
                          isBusy={busyPromptId === prompt.id.toString()}
                          plaintext={unlockedPrompts[prompt.id.toString()]}
                          onUnlock={(promptId) => void handleUnlock(promptId)}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="created" className="mt-0 space-y-4">
                  {createdQuery.isLoading ? (
                    <LoadingState label="Loading creator inventory..." />
                  ) : createdPrompts.length === 0 ? (
                    <EmptyState
                      icon={Boxes}
                      title="No creator inventory for this wallet"
                      body="Create your first encrypted prompt listing to see pricing controls, sales count, and active or paused listing states here."
                      action={{
                        label: "Create listing",
                        to: "/sell",
                        icon: ArrowUpRight,
                      }}
                    />
                  ) : (
                    <div className="space-y-4">
                      {createdPrompts.map((prompt) => (
                        <CreatedPromptCard
                          key={prompt.id.toString()}
                          prompt={prompt}
                          isBusy={busyPromptId === prompt.id.toString()}
                          priceDraft={mergedDrafts[prompt.id.toString()]}
                          onDraftChange={(value) =>
                            setPriceDrafts((current) => ({
                              ...current,
                              [prompt.id.toString()]: value,
                            }))
                          }
                          onUpdatePrice={(promptId) => void handleUpdatePrice(promptId)}
                          onToggleStatus={(promptId, active) =>
                            void handleToggleSaleStatus(promptId, active)
                          }
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
