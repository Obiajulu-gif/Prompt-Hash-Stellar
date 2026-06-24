import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgeCheck,
  BookOpenCheck,
  Bookmark,
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
import { TipButton } from "@/components/TipButton";
import { UnlockExplainer, type UnlockState } from "@/components/UnlockExplainer";
import { WebhookSettings } from "@/components/WebhookSettings";
import { CreatorDashboard } from "@/components/analytics/CreatorDashboard";
import { PostVersionUpdate } from "@/components/PostVersionUpdate";
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
import {
  fetchSavedPrompts,
  savePromptListing,
  unsavePromptListing,
  type SavedPromptListing,
} from "@/lib/prompts/library";
import { shortenAddress } from "@/lib/utils";
import { stellarNetwork } from "@/lib/env";
import { connectWallet } from "@/util/wallet";
import { usePageMeta } from "@/lib/seo/usePageMeta";

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
                <span
                  className="ml-auto shrink-0 text-xs text-slate-500"
                  aria-live="polite"
                >
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
  unlockState,
  onUnlock,
}: {
  prompt: PromptRecord;
  isBusy: boolean;
  plaintext?: string;
  unlockState: UnlockState;
  onUnlock: Handler<[bigint]>;
}) {
  const isUnlocked = Boolean(plaintext);
  const showExplainer = unlockState !== "idle" && unlockState !== "success";

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

          {/* Unlock explainer for active / error states */}
          {showExplainer && (
            <div className="mt-4">
              <UnlockExplainer
                state={unlockState}
                onRetry={
                  unlockState === "rejected" ||
                  unlockState === "expired" ||
                  unlockState === "failed"
                    ? () => onUnlock(prompt.id)
                    : undefined
                }
              />
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              className="h-10 bg-cyan-200 text-slate-950 hover:bg-cyan-100 disabled:opacity-50"
              onClick={() => onUnlock(prompt.id)}
              disabled={isBusy || unlockState === "signing" || unlockState === "verifying"}
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
  walletAddress,
  onDraftChange,
  onUpdatePrice,
  onToggleStatus,
}: {
  prompt: PromptRecord;
  isBusy: boolean;
  priceDraft: string;
  walletAddress: string;
  onDraftChange: Handler<[string]>;
  onUpdatePrice: Handler<[bigint]>;
  onToggleStatus: Handler<[bigint, boolean]>;
}) {
  const [currentVersion, setCurrentVersion] = useState(1);
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
          <div className="mt-4">
            <PostVersionUpdate
              promptId={prompt.id.toString()}
              promptTitle={prompt.title}
              walletAddress={walletAddress}
              currentVersion={currentVersion}
              onSuccess={(v) => setCurrentVersion(v)}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function SavedPromptCard({
  savedPrompt,
  isBusy,
  onToggleSaved,
}: {
  savedPrompt: SavedPromptListing;
  isBusy: boolean;
  onToggleSaved: Handler<[string, boolean]>;
}) {
  const { prompt } = savedPrompt;
  const isActive = prompt.isActive ?? true;

  return (
    <article className="overflow-hidden rounded-xl border border-white/10 bg-[#0f1419] transition-colors hover:border-white/[0.18]">
      <div className="grid lg:grid-cols-[10rem_1fr]">
        <img
          src={prompt.image || promptImageFallback}
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
              <Bookmark className="mr-1 h-3.5 w-3.5" />
              {isActive ? "Saved listing" : "Paused listing"}
            </Badge>
            <Badge className="border-white/10 bg-white/[0.04] text-slate-300">
              {prompt.category}
            </Badge>
            <Badge className="border-white/10 bg-white/[0.04] text-slate-300">
              {new Date(savedPrompt.savedAt).toLocaleDateString()}
            </Badge>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold text-white">{prompt.title}</h3>
              <p className="mt-2 line-clamp-2 text-sm leading-7 text-slate-400">
                {prompt.content}
              </p>
            </div>
            <div className="flex gap-3 text-sm xl:w-60">
              <div className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                  Price
                </p>
                <p className="mt-1.5 text-xl font-semibold text-white">
                  {prompt.price.toLocaleString()} XLM
                </p>
              </div>
              <div className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                  Owner
                </p>
                <p className="mt-1.5 text-xl font-semibold text-white">
                  {prompt.owner?.username ?? "Creator"}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              className="h-10 shrink-0 border-white/15 bg-white/[0.03] text-white hover:bg-white/10 disabled:opacity-50"
              onClick={() => onToggleSaved(savedPrompt.promptId, true)}
              disabled={isBusy}
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bookmark className="h-4 w-4" />
              )}
              Remove from saved
            </Button>
            <p className="font-mono text-xs text-slate-600">
              {shortHash(savedPrompt.promptId)}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function ProfilePage() {
  usePageMeta({
    title: "My Profile",
    description: "Manage your purchased prompts, listings, and wallet settings on Prompt Hash Stellar.",
  });

  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const viewAddress = searchParams.get("address");
  const { address, network, signMessage, signTransaction } = useWallet();
  const { xlm, isLoading: isBalanceLoading } = useWalletBalance();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [unlockedPrompts, setUnlockedPrompts] = useState<Record<string, string>>({});
  const [unlockStates, setUnlockStates] = useState<Record<string, UnlockState>>({});

  const isPublicView = Boolean(viewAddress) && viewAddress !== address;
  const profileAddress = viewAddress ?? address;

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

  const savedQuery = useQuery({
    queryKey: ["saved-prompts", address],
    queryFn: async () => (address ? fetchSavedPrompts(address) : []),
    enabled: Boolean(address),
  });

  const createdPrompts = createdQuery.data ?? [];
  const purchasedPrompts = purchasedQuery.data ?? [];
  const savedPrompts = savedQuery.data ?? [];
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
        promptId.toString(),
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

  const handleToggleSaved = async (promptId: string, saved: boolean) => {
    if (!address) {
      updateError("Connect a wallet before saving listings.");
      return;
    }

    setBusyPromptId(promptId);
    try {
      if (saved) {
        await unsavePromptListing(address, promptId);
      } else {
        await savePromptListing(address, promptId);
      }
      updateStatus(saved ? "Listing removed from saved items." : "Listing saved.");
      await queryClient.invalidateQueries({ queryKey: ["saved-prompts"] });
    } catch (error) {
      updateError(error instanceof Error ? error.message : "Failed to update saved listings.");
    } finally {
      setBusyPromptId(null);
    }
  };

  const setUnlockState = (id: string, state: UnlockState) =>
    setUnlockStates((current) => ({ ...current, [id]: state }));

  const handleUnlock = async (promptId: bigint) => {
    if (!address || !signMessage) {
      updateError("Connect a wallet with SEP-43 message signing to unlock prompts.");
      return;
    }
    const id = promptId.toString();
    setBusyPromptId(id);
    setUnlockState(id, "signing");
    try {
      const response = await unlockPromptContent(address, promptId, signMessage);
      setUnlockedPrompts((current) => ({
        ...current,
        [id]: response.plaintext,
      }));
      setUnlockState(id, "success");
      updateStatus("Prompt unlocked. You can re-open it from this library.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.toLowerCase().includes("declined") || msg.toLowerCase().includes("rejected")) {
        setUnlockState(id, "rejected");
      } else if (msg.toLowerCase().includes("expired")) {
        setUnlockState(id, "expired");
      } else {
        setUnlockState(id, "failed");
      }
      updateError(msg || "Failed to unlock prompt.");
    } finally {
      setBusyPromptId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_60%_40%_at_0%_0%,rgba(34,211,238,0.1),transparent),radial-gradient(ellipse_50%_30%_at_100%_5%,rgba(251,191,36,0.07),transparent),linear-gradient(180deg,#080b0f_0%,#0d1117_50%,#080b0f_100%)] text-white">
      <Navigation />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        {/* Page header */}
        <section className="flex flex-col justify-between gap-6 rounded-[2rem] border border-white/10 bg-slate-950/60 p-5 shadow-[0_32px_120px_-64px_rgba(16,185,129,0.45)] md:flex-row md:items-center md:p-8">
          <div className="space-y-4">
            <p className="text-sm uppercase tracking-[0.35em] text-emerald-300">
              {isPublicView ? "Creator profile" : "Wallet profile"}
            </p>
            <h1 className="text-3xl font-semibold sm:text-4xl">
              {isPublicView ? "Prompt creator" : "My prompt licenses"}
            </h1>
            <p className="max-w-xl text-sm leading-7 text-slate-300">
              {isPublicView
                ? "View this creator's public prompt listings and send a tip to support their work."
                : "Manage listings you created and reopen prompts you purchased. This page reads directly from the Stellar contract and uses the unlock API only when you request the decrypted plaintext."}
            </p>
          </div>

          {address && !isPublicView && (
            <div className="flex flex-col gap-4 rounded-3xl border border-white/5 bg-white/5 p-5 backdrop-blur-sm md:min-w-[300px] md:p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <Wallet size={20} />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Active Wallet
                  </p>
                  <p className="font-mono text-sm text-slate-200">
                    {address.slice(0, 6)}...{address.slice(-6)}
                  </p>
                </div>
              </div>
              <div className="h-px bg-white/10" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Balance
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white">
                    {isBalanceLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      xlm
                    )}
                  </span>
                  <span className="text-sm font-medium text-emerald-400">XLM</span>
                </div>
              </div>
            </div>
          )}

          {/* Tip jar for public profile views */}
          {isPublicView && profileAddress && (
            <div className="md:min-w-[280px]">
              <TipButton creatorAddress={profileAddress} />
            </div>
          )}
        </section>

        <div>
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

              <div className="space-y-3 mt-4">
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

                  <TabsList className="mb-6 grid h-auto w-full grid-cols-3 rounded-xl border border-white/10 bg-white/[0.03] p-1.5 sm:w-[48rem]">
                    <TabsTrigger
                      value="purchased"
                      aria-label="Open my library tab"
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
                      aria-label="Open my inventory tab"
                      className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-slate-400 transition-all data-[state=active]:bg-amber-300 data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
                    >
                      <Boxes className="h-4 w-4" />
                      My Inventory
                      <span className="ml-1 rounded-full bg-slate-950/10 px-1.5 py-0.5 text-xs">
                        {createdPrompts.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="saved"
                      aria-label="Open saved listings tab"
                      className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-slate-400 transition-all data-[state=active]:bg-emerald-300 data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
                    >
                      <Bookmark className="h-4 w-4" />
                      Saved
                      <span className="ml-1 rounded-full bg-slate-950/10 px-1.5 py-0.5 text-xs">
                        {savedPrompts.length}
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
                            unlockState={unlockStates[prompt.id.toString()] ?? "idle"}
                            onUnlock={(promptId) => void handleUnlock(promptId)}
                          />
                        ))}
                        <div className="pt-2 text-center">
                          <Link
                            to="/purchases"
                            className="text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors"
                          >
                            Open full purchases page →
                          </Link>
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="created" className="mt-0 space-y-6">
                    {/* Creator activity dashboard — metrics, revenue, top performers (#213) */}
                    {!isPublicView && address && (
                      <CreatorDashboard walletAddress={address} />
                    )}

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
                            walletAddress={address}
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
                    <WebhookSettings walletAddress={address} />
                  </TabsContent>

                  <TabsContent value="saved" className="mt-0 space-y-4">
                    {savedQuery.isLoading ? (
                      <LoadingState label="Loading your saved listings..." />
                    ) : savedPrompts.length === 0 ? (
                      <EmptyState
                        icon={Bookmark}
                        title="No saved listings yet"
                        body="Save marketplace prompts while browsing to keep a short list of listings you want to revisit or compare later."
                        action={{
                          label: "Browse marketplace",
                          to: "/browse",
                          icon: ShoppingBag,
                        }}
                        accent="cyan"
                      />
                    ) : (
                      <div className="space-y-4">
                        {savedPrompts.map((savedPrompt) => (
                          <SavedPromptCard
                            key={savedPrompt.promptId}
                            savedPrompt={savedPrompt}
                            isBusy={busyPromptId === savedPrompt.promptId}
                            onToggleSaved={(promptId, saved) =>
                              void handleToggleSaved(promptId, saved)
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
        </div>
      </main>
      <Footer />
    </div>
  );
}
