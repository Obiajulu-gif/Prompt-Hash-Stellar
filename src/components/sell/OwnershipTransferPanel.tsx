import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Check,
  Clock,
  Loader2,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cancelOwnershipTransfer,
  listOwnershipTransfers,
  requestOwnershipTransfer,
  respondOwnershipTransfer,
  type OwnershipTransferDto,
  type OwnershipTransferStatus,
} from "@/lib/prompts/ownershipTransfer";

interface TransferablePrompt {
  id: bigint;
  title: string;
}

interface OwnershipTransferPanelProps {
  walletAddress: string;
  createdPrompts: TransferablePrompt[];
  signMessage?: (
    _message: string,
  ) => Promise<{ signedMessage?: string } | string>;
}

const STATUS_STYLES: Record<OwnershipTransferStatus, string> = {
  pending: "border-amber-500/25 bg-amber-500/10 text-amber-400",
  approved: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
  rejected: "border-red-500/25 bg-red-500/10 text-red-400",
  cancelled: "border-slate-500/25 bg-slate-500/10 text-slate-400",
  expired: "border-slate-500/25 bg-slate-500/10 text-slate-500",
};

const STATUS_LABEL: Record<OwnershipTransferStatus, string> = {
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  expired: "Expired",
};

function shortWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 4)}\u2026${wallet.slice(-4)}`;
}

function expiresInLabel(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return "Expired";
  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  return hours > 48
    ? `Expires in ${Math.round(hours / 24)}d`
    : `Expires in ${hours}h`;
}

export function OwnershipTransferPanel({
  walletAddress,
  createdPrompts,
  signMessage,
}: OwnershipTransferPanelProps) {
  const queryClient = useQueryClient();
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [recipientWallet, setRecipientWallet] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"request" | string | null>(null);

  const transfersQuery = useQuery({
    queryKey: ["ownership-transfers", walletAddress],
    queryFn: () => listOwnershipTransfers(walletAddress),
    enabled: Boolean(walletAddress),
    refetchOnWindowFocus: false,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["ownership-transfers"] });

  const signedMessage = async (message: string): Promise<string> => {
    if (!signMessage) {
      throw new Error("Connect a wallet with message signing to continue.");
    }
    const result = await signMessage(message);
    return typeof result === "string" ? result : (result.signedMessage ?? "");
  };

  const handleRequest = async () => {
    if (!selectedPromptId) {
      setActionError("Select a listing to hand off.");
      return;
    }
    const toWallet = recipientWallet.trim().toUpperCase();
    if (!/^[A-Z0-9]{56}$/.test(toWallet)) {
      setActionError("Enter a valid 56-character Stellar address.");
      return;
    }
    if (toWallet === walletAddress.toUpperCase()) {
      setActionError("The handoff target must differ from your own wallet.");
      return;
    }

    setActionError(null);
    setBusy("request");
    try {
      const message = `prompt-hash transfer request:${selectedPromptId}:${toWallet}`;
      const signature = await signedMessage(message);
      if (!signature) {
        throw new Error("The wallet did not return a signature.");
      }
      await requestOwnershipTransfer({
        promptId: selectedPromptId,
        fromWallet: walletAddress,
        toWallet,
        signature,
      });
      setSelectedPromptId("");
      setRecipientWallet("");
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to request transfer.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleRespond = async (
    transfer: OwnershipTransferDto,
    decision: "approved" | "rejected",
  ) => {
    setActionError(null);
    setBusy(`${transfer.id}-${decision}`);
    try {
      const message = `prompt-hash transfer ${decision}:${transfer.id}`;
      const signature = await signedMessage(message);
      if (!signature) {
        throw new Error("The wallet did not return a signature.");
      }
      await respondOwnershipTransfer(transfer.id, {
        walletAddress,
        decision,
        signature,
      });
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to respond to transfer.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async (transfer: OwnershipTransferDto) => {
    setActionError(null);
    setBusy(`${transfer.id}-cancel`);
    try {
      const message = `prompt-hash transfer cancel:${transfer.id}`;
      const signature = await signedMessage(message);
      if (!signature) {
        throw new Error("The wallet did not return a signature.");
      }
      await cancelOwnershipTransfer(transfer.id, { walletAddress, signature });
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to cancel transfer.",
      );
    } finally {
      setBusy(null);
    }
  };

  const inbound = transfersQuery.data?.inbound ?? [];
  const outbound = transfersQuery.data?.outbound ?? [];

  const renderTransfer = (
    transfer: OwnershipTransferDto,
    variant: "inbound" | "outbound",
  ) => {
    const isBusy =
      busy === `${transfer.id}-approved` ||
      busy === `${transfer.id}-rejected` ||
      busy === `${transfer.id}-cancel`;
    const fromLabel =
      variant === "outbound" ? "Handed off to" : "Handed off from";
    const counterparty =
      variant === "outbound" ? transfer.toWallet : transfer.fromWallet;

    return (
      <div
        key={transfer.id}
        className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-100">
              {transfer.promptTitle}
            </p>
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                STATUS_STYLES[transfer.status]
              }`}
            >
              {transfer.status === "pending" ? (
                <Clock className="h-3 w-3" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              {STATUS_LABEL[transfer.status]}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {fromLabel}{" "}
            <span className="font-mono text-slate-400">
              {shortWallet(counterparty)}
            </span>
            {transfer.status === "pending" ? (
              <span className="ml-2 text-amber-500/80">
                {expiresInLabel(transfer.expiresAt)}
              </span>
            ) : null}
          </p>
        </div>

        {transfer.status === "pending" && variant === "inbound" ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30"
              onClick={() => void handleRespond(transfer, "approved")}
              disabled={Boolean(busy)}
            >
              {busy === `${transfer.id}-approved` ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-white/10 text-slate-400 hover:border-red-400/30 hover:text-red-300"
              onClick={() => void handleRespond(transfer, "rejected")}
              disabled={Boolean(busy)}
            >
              {busy === `${transfer.id}-rejected` ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              Reject
            </Button>
          </div>
        ) : null}

        {transfer.status === "pending" && variant === "outbound" ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5 border-white/10 text-slate-400 hover:border-red-400/30 hover:text-red-300"
            onClick={() => void handleCancel(transfer)}
            disabled={Boolean(busy)}
          >
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            Cancel
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-white">
          Ownership transfers
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Hand a listing you created to another wallet. The on-chain creator
          record is fixed; the recipient only takes over the indexed listing
          ownership used for analytics and payouts. The recipient must approve
          the handoff.
        </p>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start gap-3">
          <ArrowLeftRight className="mt-1 h-5 w-5 text-cyan-300" />
          <div>
            <h3 className="font-semibold text-white">Request a handoff</h3>
            <p className="mt-1 text-sm text-slate-400">
              Pick one of your listings, enter the recipient&apos;s address, and
              approve the signing prompt.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
          <Select
            value={selectedPromptId}
            onValueChange={setSelectedPromptId}
            disabled={createdPrompts.length === 0}
          >
            <SelectTrigger className="border-white/10 bg-slate-950/50 text-slate-100">
              <SelectValue
                placeholder={
                  createdPrompts.length === 0
                    ? "Create a listing first"
                    : "Select a listing to hand off"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {createdPrompts.map((prompt) => (
                <SelectItem
                  key={prompt.id.toString()}
                  value={prompt.id.toString()}
                >
                  {prompt.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={recipientWallet}
            onChange={(event) => setRecipientWallet(event.target.value)}
            placeholder="Recipient Stellar address"
            className="border-white/10 bg-slate-950/50 text-slate-100"
          />
          <Button
            type="button"
            className="gap-2 bg-cyan-400 text-slate-950 hover:bg-cyan-300"
            onClick={() => void handleRequest()}
            disabled={
              busy !== null ||
              createdPrompts.length === 0 ||
              !signMessage
            }
          >
            {busy === "request" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Request handoff
          </Button>
        </div>
        {!signMessage ? (
          <p className="mt-3 text-xs text-slate-500">
            Connect a wallet with SEP-43 message signing to request or respond
            to handoffs.
          </p>
        ) : null}
      </div>

      {actionError ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {actionError}
        </div>
      ) : null}

      {transfersQuery.isLoading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-slate-300">
          Loading ownership transfers...
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
              Sent to you
            </h3>
            {inbound.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-slate-500">
                No one has offered you a listing handoff yet.
              </p>
            ) : (
              inbound.map((transfer) => renderTransfer(transfer, "inbound"))
            )}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
              Sent by you
            </h3>
            {outbound.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-slate-500">
                You have not requested any listing handoffs.
              </p>
            ) : (
              outbound.map((transfer) => renderTransfer(transfer, "outbound"))
            )}
          </div>
        </div>
      )}
    </section>
  );
}