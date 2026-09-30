import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { createFocusTrap, setFocusOn } from "@/lib/accessibility/formHelpers";

export function Dialog({
  children,
  open,
  onClose,
  labelledBy,
  describedBy,
}: {
  children: React.ReactNode;
  open: boolean;
  onClose?: () => void;
  labelledBy?: string;
  describedBy?: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Move focus into the dialog when it opens
    const firstFocusable = overlayRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    setFocusOn(firstFocusable ?? null);

    // Escape key closes dialog
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onKeyDown={(e) => {
          if (!overlayRef.current) return;
          createFocusTrap(overlayRef.current).handleKeyDown(e.nativeEvent);
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`relative w-full max-w-md rounded-xl bg-slate-900 p-6 border border-white/10 text-white shadow-xl ${className}`}>{children}</div>;
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

export function DialogTitle({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <h2 id={id} className={`text-xl font-bold tracking-tight ${className}`}>{children}</h2>;
}

export function DialogDescription({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <p id={id} className={`text-sm text-slate-400 mt-1 ${className}`}>{children}</p>;
}

interface DisputeModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptId: string;
  buyerWallet: string;
}

const DIALOG_TITLE_ID = "dispute-modal-title";
const DIALOG_DESC_ID = "dispute-modal-desc";
const REASON_ERROR_ID = "dispute-reason-error";

async function openDisputeOnChain(params: {
  promptId: string;
  buyerWallet: string;
  contractId: string;
  rpcUrl: string;
  publicKey: string;
}): Promise<{ txHash: string; success: boolean }> {
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
    <Dialog open={isOpen} onClose={handleClose} labelledBy={DIALOG_TITLE_ID} describedBy={DIALOG_DESC_ID}>
      <DialogContent className="border-white/10 bg-slate-900 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle id={DIALOG_TITLE_ID} className="flex items-center gap-2 text-lg font-bold">
            <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden="true" />
            Open a Dispute
          </DialogTitle>
          <DialogDescription id={DIALOG_DESC_ID} className="text-slate-400">
            Open a dispute if the prompt content could not be decrypted or was
            not delivered as described. This action is recorded on-chain.
          </DialogDescription>
        </DialogHeader>

        {mutation.isSuccess ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center" role="status" aria-live="polite">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" aria-hidden="true" />
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
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <label htmlFor="dispute-reason" className="text-sm font-medium text-slate-300">
                Reason for dispute{" "}
                <span className="text-slate-400 font-normal">(optional note)</span>
              </label>
              <textarea
                id="dispute-reason"
                placeholder="Briefly describe the issue with this prompt..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                aria-describedby={`${REASON_ERROR_ID} dispute-reason-count`}
                className="w-full border border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-red-500/50 focus:ring-red-500/20 resize-none rounded-lg px-3 py-2"
                disabled={mutation.isPending}
              />
              <p id="dispute-reason-count" className="text-xs text-slate-500">{reason.length}/500 characters</p>
            </div>

            {mutation.isError && (
              <div
                id={REASON_ERROR_ID}
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400"
              >
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
                aria-busy={mutation.isPending}
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Opening dispute…</span>
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
