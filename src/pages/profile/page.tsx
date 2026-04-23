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
      role="alert"
      className={
        tone === "success"
          ? "rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100"
          : "rounded-xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100"
      }
    >
      {message}
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-56 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-8 text-sm text-slate-300">
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
  accent = "cyan",
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action: { label: string; to: string; icon: LucideIcon };
  accent?: "cyan" | "amber";
}) {
  const ActionIcon = action.icon;
  const isCyan = accent === "cyan";

  return (
    <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
      <div className="max-w-sm">
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ${
            isCyan ? "bg-cyan-200/10 text-cyan-100" : "bg-amber-300/10 text-amber-200"
          }`}
        >
          <Icon className="h-8 w-8" />
        </div>
        <h3 className="mt-5 text-xl font-semibold text-white">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-slate-400">{body}</p>
        <Button
          asChild
          className={`mt-6 h-10 px-6 ${
            isCyan
              ? "bg-cyan-200 text-slate-950 hover:bg-cyan-100"
              : "bg-amber-300 text-slate-950 hover:bg-amber-200"
          }`}
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

function DisconnectedProfile() {
  return (
    <section className="space-y-5 py-10">
      {/* Hero panel */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d1117] p-8 shadow-[0_32px_96px_-48px_rgba(34,211,238,0.45)] md:p-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_0%_0%,rgba(34,211,238,0.12),transparent)]" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-200/10 text-cyan-100">
              <Wallet className="h-6 w-6" />
            </div>
            <Badge className="border-cyan-200/30 bg-cyan-200/10 text-cyan-100">
              Wallet required
            </Badge>
          </div>
          <h1 className="mt-6 max-w-2xl text-4xl font-semibold leading-tight text-white md:text-5xl">
            Your prompt library starts with a Stellar wallet.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-300">
            Connect to see licensed prompts you can reopen, creator inventory you
            control, and listing states tied to your wallet identity.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              className="h-11 bg-cyan-200 px-6 text-slate-950 hover:bg-cyan-100 active:scale-95"
              onClick={() => void connectWallet()}
            >
              <PlugZap className="h-4 w-4" />
              Connect wallet
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 border-white/15 bg-white/[0.03] px-6 text-white hover:bg-white/10"
            >
              <Link to="/browse">
                <ShoppingBag className="h-4 w-4" />
                Browse prompts
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Feature strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: KeyRound,
            accent: "cyan" as const,
            title: "Purchased licenses",
            body: "Unlocked access is grouped separately from creator listings — your library, not a marketplace view.",
          },
          {
            icon: Boxes,
            accent: "amber" as const,
            title: "Creator inventory",
            body: "Pricing controls, sales counts, and active or paused states stay in their own dedicated section.",
          },
          {
            icon: ShieldCheck,
            accent: "emerald" as const,
            title: "Wallet-authenticated access",
            body: "Full prompt content appears only after your wallet signs an unlock request via SEP-43.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5"
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                item.accent === "cyan"
                  ? "bg-cyan-200/10 text-cyan-100"
                  : item.accent === "amber"
                    ? "bg-amber-300/10 text-amber-200"
                    : "bg-emerald-300/10 text-emerald-100"
              }`}
            >
              <item.icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-white">{item.title}</h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-400">{item.body}</p>
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
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section className="py-8">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d1117] shadow-[0_32px_96px_-48px_rgba(56,189,248,0.45)]">
        {/* Identity header */}
        <div className="relative p-6 md:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_100%_0%,rgba(56,189,248,0.1),transparent)]" />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-center">
            {/* Wallet avatar with connected indicator */}
            <div className="relative shrink-0">
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-cyan-200/20 bg-gradient-to-br from-cyan-200/15 to-sky-400/10 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                <Wallet className="h-11 w-11" />
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#0d1117] bg-emerald-400">
                <CheckCircle2 className="h-3 w-3 text-slate-950" />
              </div>
            </div>

            {/* Address block */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-slate-400">Connected identity</p>
                <Badge className="border-white/10 bg-white/[0.05] text-slate-200">
                  <RadioTower className="mr-1 h-3 w-3" />
                  {formatNetworkName(network ?? stellarNetwork)}
                </Badge>
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white md:text-4xl">
                {shortenAddress(address)}
              </h1>
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy wallet address"
                className="group mt-3 flex w-full max-w-lg cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-left transition-all hover:border-cyan-200/20 hover:bg-slate-950/80"
              >
                {copied ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5 shrink-0 text-cyan-200 group-hover:text-cyan-100" />
                )}
                <span className="min-w-0 truncate font-mono text-xs text-slate-300">
                  {address}
                </span>
                <span className="ml-auto shrink-0 text-xs text-slate-500">
                  {copied ? "Copied!" : "Copy"}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 divide-x divide-y divide-white/[0.06] border-t border-white/[0.06] sm:grid-cols-4 sm:divide-y-0">
          {[
            { icon: BadgeCheck, label: "Owned licenses", value: purchasedCount },
            { icon: PanelTopOpen, label: "Created prompts", value: createdCount },
            { icon: CheckCircle2, label: "Active listings", value: activeCount },
            {
              icon: Wallet,
              label: "Balance",
              value: isBalanceLoading ? "—" : `${balanceLabel} XLM`,
            },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex flex-col gap-1.5 px-6 py-5">
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-cyan-200" />
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                  {label}
                </p>
              </div>
              <p className="text-2xl font-semibold tabular-nums text-white">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
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
    <article className="overflow-hidden rounded-xl border border-white/10 bg-[#0f1419] transition-colors hover:border-white/[0.18]">
      <div className="grid md:grid-cols-[14rem_1fr]">
        {/* Prompt image */}
        <div className="relative h-52 md:h-auto">
          <img
            src={prompt.imageUrl || promptImageFallback}
            alt={prompt.title}
            className="h-full w-full object-cover"
          />
          {/* Mobile-only access state pill */}
          <div className="absolute bottom-3 left-3 md:hidden">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium backdrop-blur-sm ${
                isUnlocked
                  ? "bg-emerald-400/25 text-emerald-200 ring-1 ring-emerald-400/20"
                  : "bg-amber-400/25 text-amber-200 ring-1 ring-amber-400/20"
              }`}
            >
              {isUnlocked ? (
                <Eye className="h-3 w-3" />
              ) : (
                <LockKeyhole className="h-3 w-3" />
              )}
              {isUnlocked ? "Unlocked" : "Locked"}
            </span>
          </div>
        </div>

        <div className="min-w-0 p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-cyan-200/30 bg-cyan-200/10 text-cyan-100">
              <BookOpenCheck className="mr-1 h-3.5 w-3.5" />
              License owned
            </Badge>
            <Badge className="border-white/10 bg-white/[0.04] text-slate-300">
              {prompt.category}
            </Badge>
            <Badge
              className={`hidden md:inline-flex ${
                isUnlocked
                  ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                  : "border-amber-300/30 bg-amber-300/10 text-amber-100"
              }`}
            >
              {isUnlocked ? (
                <Eye className="mr-1 h-3.5 w-3.5" />
              ) : (
                <LockKeyhole className="mr-1 h-3.5 w-3.5" />
              )}
              {isUnlocked ? "Unlocked" : "Wallet unlock needed"}
            </Badge>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_10rem]">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold text-white">{prompt.title}</h3>
              <p className="mt-2 line-clamp-2 text-sm leading-7 text-slate-400">
                {prompt.previewText}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                Paid access
              </p>
              <p className="mt-1.5 text-lg font-semibold text-white">
                {formatPriceLabel(prompt.priceStroops)}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              className="h-10 bg-cyan-200 text-slate-950 hover:bg-cyan-100 disabled:opacity-50"
              onClick={() => onUnlock(prompt.id)}
              disabled={isBusy}
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Unlocking...
                </>
              ) : isUnlocked ? (
                <>
                  <Eye className="h-4 w-4" />
                  Re-open prompt
                </>
              ) : (
                <>
                  <LockKeyhole className="h-4 w-4" />
                  Unlock full prompt
                </>
              )}
            </Button>
            <p className="font-mono text-xs text-slate-600">
              {shortHash(prompt.contentHash)}
            </p>
          </div>

          {plaintext ? (
            <div className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.07] p-5">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-emerald-200">
                <ShieldCheck className="h-4 w-4" />
                Unlocked content
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-7 text-slate-100">
                {plaintext}
              </pre>
            </div>
          ) : null}
        </div>
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
  const isActive = prompt.active;

  return (
    <article className="overflow-hidden rounded-xl border border-white/10 bg-[#0f1419] transition-colors hover:border-white/[0.18]">
      <div className="grid lg:grid-cols-[10rem_1fr]">
        <img
          src={prompt.imageUrl || promptImageFallback}
          alt={prompt.title}
          className="h-48 w-full object-cover lg:h-full"
        />
        <div className="min-w-0 p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={
                isActive
                  ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                  : "border-amber-300/30 bg-amber-300/10 text-amber-100"
              }
            >
              {isActive ? (
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              ) : (
                <PauseCircle className="mr-1 h-3.5 w-3.5" />
              )}
              {isActive ? "Active listing" : "Paused listing"}
            </Badge>
            <Badge className="border-white/10 bg-white/[0.04] text-slate-300">
              {prompt.category}
            </Badge>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold text-white">{prompt.title}</h3>
              <p className="mt-2 line-clamp-2 text-sm leading-7 text-slate-400">
                {prompt.previewText}
              </p>
            </div>
            <div className="flex gap-3 text-sm xl:w-60">
              <div className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                  Sales
                </p>
                <p className="mt-1.5 text-xl font-semibold text-white">
                  {prompt.salesCount}
                </p>
              </div>
              <div className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                  Price
                </p>
                <p className="mt-1.5 text-xl font-semibold text-white">
                  {formatPriceLabel(prompt.priceStroops)}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="flex flex-1 items-center gap-2">
              <Input
                value={priceDraft}
                onChange={(event) => onDraftChange(event.target.value)}
                className="h-10 min-w-0 max-w-[10rem] border-white/10 bg-white/[0.04] text-slate-100"
                placeholder="Price in XLM"
                aria-label={`Price in XLM for ${prompt.title}`}
              />
              <Button
                className="h-10 shrink-0 bg-amber-300 text-slate-950 hover:bg-amber-200 disabled:opacity-50"
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
            </div>
            <Button
              variant="outline"
              className="h-10 shrink-0 border-white/15 bg-white/[0.03] text-white hover:bg-white/10 disabled:opacity-50"
              onClick={() => onToggleStatus(prompt.id, prompt.active)}
              disabled={isBusy}
            >
              {isActive ? (
                <CircleOff className="h-4 w-4" />
              ) : (
                <ArrowUpRight className="h-4 w-4" />
              )}
              {isActive ? "Pause listing" : "Reactivate"}
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
  const activeListingCount = createdPrompts.filter((p) => p.active).length;

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
      updateError(
        error instanceof Error ? error.message : "Failed to update price.",
      );
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
      updateError(
        error instanceof Error ? error.message : "Failed to unlock prompt.",
      );
    } finally {
      setBusyPromptId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_60%_40%_at_0%_0%,rgba(34,211,238,0.1),transparent),radial-gradient(ellipse_50%_30%_at_100%_5%,rgba(251,191,36,0.07),transparent),linear-gradient(180deg,#080b0f_0%,#0d1117_50%,#080b0f_100%)] text-white">
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

            <section className="mt-10">
              <Tabs defaultValue="purchased" className="space-y-0">
                <div className="mb-6">
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">
                    Prompt access
                  </p>
                  <h2 className="mt-2 text-3xl font-semibold text-white">
                    Library &amp; Inventory
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                    Licensed prompts are optimized for re-entry and unlock. Created
                    prompts stay focused on listing control.
                  </p>
                </div>

                <TabsList className="mb-6 grid h-auto w-full grid-cols-2 rounded-xl border border-white/10 bg-white/[0.03] p-1.5 sm:w-[34rem]">
                  <TabsTrigger
                    value="purchased"
                    className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-slate-400 transition-all data-[state=active]:bg-cyan-200 data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
                  >
                    <LibraryBig className="h-4 w-4" />
                    My Library
                    <span className="ml-1 rounded-full bg-slate-950/10 px-1.5 py-0.5 text-xs">
                      {purchasedPrompts.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="created"
                    className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-slate-400 transition-all data-[state=active]:bg-amber-300 data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
                  >
                    <Boxes className="h-4 w-4" />
                    My Inventory
                    <span className="ml-1 rounded-full bg-slate-950/10 px-1.5 py-0.5 text-xs">
                      {createdPrompts.length}
                    </span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="purchased" className="mt-0 space-y-4">
                  {purchasedQuery.isLoading ? (
                    <LoadingState label="Loading your licensed prompts..." />
                  ) : purchasedPrompts.length === 0 ? (
                    <EmptyState
                      icon={LibraryBig}
                      title="Your library is empty"
                      body="When this wallet buys access, prompts appear here with a direct unlock path back to the protected content."
                      action={{
                        label: "Browse marketplace",
                        to: "/browse",
                        icon: ShoppingBag,
                      }}
                      accent="cyan"
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
                    <LoadingState label="Loading your creator inventory..." />
                  ) : createdPrompts.length === 0 ? (
                    <EmptyState
                      icon={Boxes}
                      title="No creator inventory"
                      body="Create your first encrypted prompt listing to see pricing controls, sales counts, and listing states here."
                      action={{
                        label: "Create listing",
                        to: "/sell",
                        icon: ArrowUpRight,
                      }}
                      accent="amber"
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
