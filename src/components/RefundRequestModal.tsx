import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { createFocusTrap, setFocusOn } from "@/lib/accessibility/formHelpers";

// --- CUSTOM INLINE DIALOG FALLBACK MODULES ---
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
    const firstFocusable = overlayRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    setFocusOn(firstFocusable ?? null);
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
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
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

const REFUND_TITLE_ID = "refund-modal-title";
const REFUND_DESC_ID = "refund-modal-desc";
const REFUND_REASON_ERROR_ID = "refund-reason-error";
const REFUND_SUBMIT_ERROR_ID = "refund-submit-error";
  isOpen: boolean;
  onClose: () => void;
  promptId: string;
  buyerWallet: string;
  disputeTxHash?: string;
}

type FulfillmentStatus = "pending" | "delivered" | "failed" | "refund_requested" | "refunded" | "rejected";

interface FulfillmentRecord {
  status: FulfillmentStatus;
  refundReason: string;
}

async function requestRefund(params: {
  promptId: string;
  buyerWallet: string;
  reason: string;
  disputeTxHash?: string;
}): Promise<FulfillmentRecord> {
  const res = await fetch(
    `/api/fulfillment/${params.promptId}/${params.buyerWallet}/request-refund`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: params.reason,
        disputeTxHash: params.disputeTxHash,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "Failed to submit refund request");
  }
  return res.json() as Promise<FulfillmentRecord>;
}

export function RefundRequestModal({
  isOpen,
  onClose,
  promptId,
  buyerWallet,
  disputeTxHash,
}: RefundRequestModalProps) {
  const [reason, setReason] = useState("");

  const mutation = useMutation<FulfillmentRecord, Error, void>({
    mutationFn: () => requestRefund({ promptId, buyerWallet, reason, disputeTxHash }),
    onSuccess: () => {
      setReason("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 10) return;
    mutation.mutate();
  };

  const handleClose = () => {
    if (mutation.isPending) return;
    mutation.reset();
    setReason("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onClose={handleClose} labelledBy={REFUND_TITLE_ID} describedBy={REFUND_DESC_ID}>
      <DialogContent className="border-white/10 bg-slate-900 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle id={REFUND_TITLE_ID} className="flex items-center gap-2 text-lg font-bold">
            <AlertTriangle className="h-5 w-5 text-amber-400" aria-hidden="true" />
            Request a Refund
          </DialogTitle>
          <DialogDescription id={REFUND_DESC_ID} className="text-slate-400">
            Use this form if your prompt content could not be decrypted or
            delivered. Our team will review your request and process an on-chain
            refund if eligible.
          </DialogDescription>
        </DialogHeader>

        {mutation.isSuccess ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center" role="status" aria-live="polite">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" aria-hidden="true" />
            <p className="font-semibold text-emerald-300">
              Refund request submitted
            </p>
            <p className="text-sm text-slate-400">
              Your request has been logged. You will be notified once it is
              reviewed. Eligible refunds are processed on-chain via the
              Stellar dispute mechanism.
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
              <label htmlFor="refund-reason" className="text-sm font-medium text-slate-300">
                Describe the issue{" "}
                <span aria-hidden="true" className="text-amber-400">*</span>
                <span className="sr-only">(required, minimum 10 characters)</span>
              </label>
              <Textarea
                id="refund-reason"
                placeholder="e.g. The prompt content could not be decrypted after purchase..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                aria-required="true"
                aria-invalid={reason.trim().length > 0 && reason.trim().length < 10 ? "true" : "false"}
                aria-describedby={`${REFUND_REASON_ERROR_ID} refund-reason-hint`}
                className="border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-emerald-500/50 focus:ring-emerald-500/20 resize-none"
                disabled={mutation.isPending}
              />
              <p id="refund-reason-hint" className="text-xs text-slate-500">
                Minimum 10 characters required.
              </p>
              {reason.trim().length > 0 && reason.trim().length < 10 && (
                <p
                  id={REFUND_REASON_ERROR_ID}
                  role="alert"
                  aria-live="assertive"
                  aria-atomic="true"
                  className="text-xs text-red-400"
                >
                  Please provide at least 10 characters.
                </p>
              )}
            </div>

            {mutation.isError && (
              <div
                id={REFUND_SUBMIT_ERROR_ID}
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
                className="bg-amber-500 text-slate-950 hover:bg-amber-400 font-bold"
                disabled={mutation.isPending || reason.trim().length < 10}
                aria-busy={mutation.isPending}
                aria-describedby={mutation.isError ? REFUND_SUBMIT_ERROR_ID : undefined}
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Submitting…</span>
                  </>
                ) : (
                  "Submit Refund Request"
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}