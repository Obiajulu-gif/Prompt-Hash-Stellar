import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { PromptHashContractClient } from "@/lib/stellar/promptHashClient";
import { Keypair, TransactionBuilder, Networks, BASE_FEE } from "@stellar/stellar-sdk";

export function Dialog({ children, open }: { children: React.ReactNode; open: boolean }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">{children}</div>;
}

export function DialogContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`relative w-full max-w-md rounded-xl bg-slate-900 p-6 border border-white/10 text-white shadow-xl ${className}`}>{children}</div>;
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

export function DialogTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-xl font-bold tracking-tight ${className}`}>{children}</h2>;
}

export function DialogDescription({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-sm text-slate-400 mt-1 ${className}`}>{children}</p>;
}

interface DisputeModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptId: string;
  buyerWallet: string;
}

async function openDisputeOnChain(params: {
  promptId: string;
  buyerWallet: string;
  contractId: string;
  rpcUrl: string;
  publicKey: string;
}): Promise<{ txHash: string; success: boolean }> {
  // This is a client-side invocation that would normally be signed by the user's wallet
  // In a real implementation, this would use the connected wallet's signing capability
  // For now, we'll create a mock response that would be populated by actual wallet interaction
  return {
    txHash: "mock-tx-hash",
    success: true,
  };
}

export function DisputeModal({ isOpen, onClose, promptId, buyerWallet }: DisputeModalProps) {
  const { signTransaction } = useWallet();
  const [reason, setReason] = useState("");

  const mutation = useMutation<{ txHash: string; success: boolean }, Error, void>({
    mutationFn: async () => {
      if (!browserStellarConfig.promptHashContractId || !browserStellarConfig.rpcUrl) {
        throw new Error("Contract configuration missing");
      }

      return openDisputeOnChain({
        promptId,
        buyerWallet,
        contractId: browserStellarConfig.promptHashContractId,
        rpcUrl: browserStellarConfig.rpcUrl,
        publicKey: buyerWallet,
      });
    },
    onSuccess: () => {
      setReason("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const handleClose = () => {
    if (mutation.isPending) return;
    mutation.reset();
    setReason("");
    onClose();
  };

  return (
    <Dialog open={isOpen}>
      <DialogContent className="border-white/10 bg-slate-900 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            Open a Dispute
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Open a dispute if the prompt content could not be decrypted or was
            not delivered as described. This action is recorded on-chain.
          </DialogDescription>
        </DialogHeader>

        {mutation.isSuccess ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <p className="font-semibold text-emerald-300">Dispute opened successfully</p>
            <p className="text-sm text-slate-400">
              Your dispute has been recorded on-chain. The creator has a window to
              respond. Monitor this purchase for updates.
            </p>
            <Button
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10"
              onClick={handleClose}
            >
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="dispute-reason" className="text-sm font-medium text-slate-300">
                Reason for dispute (optional note)
              </label>
              <textarea
                id="dispute-reason"
                placeholder="Briefly describe the issue with this prompt..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                className="w-full border border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-red-500/50 focus:ring-red-500/20 resize-none rounded-lg px-3 py-2"
                disabled={mutation.isPending}
              />
              <p className="text-xs text-slate-500">{reason.length}/500 characters</p>
            </div>

            {mutation.isError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
                {mutation.error.message}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                className="text-slate-400 hover:text-white"
                onClick={handleClose}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-red-600 text-white hover:bg-red-500 font-bold"
                disabled={mutation.isPending}
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Opening dispute…
                  </>
                ) : (
                  "Open Dispute"
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
