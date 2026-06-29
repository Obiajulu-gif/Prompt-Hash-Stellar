import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

interface RefundRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptId: string;
  buyerWallet: string;
  /** Optional on-chain dispute transaction hash the buyer already submitted. */
  disputeTxHash?: string;
}

type FulfillmentStatus =
  | "pending"
  | "delivered"
  | "failed"
  | "refund_requested"
  | "refunded"
  | "rejected";

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
    throw new Error(
      (body as { error?: string }).error ?? "Failed to submit refund request",
    );
  }
  return res.json() as Promise<FulfillmentRecord>;
}

/**
 * Modal that allows a buyer to request a refund for a failed prompt unlock.
 * Calls the /api/fulfillment/:promptId/:buyerWallet/request-refund endpoint
 * and shows the result (#335).
 */
export function RefundRequestModal({
  isOpen,
  onClose,
  promptId,
  buyerWallet,
  disputeTxHash,
}: RefundRequestModalProps) {
  const [reason, setReason] = useState("");

  const mutation = useMutation<FulfillmentRecord, Error, void>({
    mutationFn: () =>
      requestRefund({ promptId, buyerWallet, reason, disputeTxHash }),
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
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="border-white/10 bg-slate-900 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Request a Refund
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Use this form if your prompt content could not be decrypted or
            delivered. Our team will review your request and process an on-chain
            refund if eligible.
          </DialogDescription>
        </DialogHeader>

        {mutation.isSuccess ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
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
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="refund-reason"
                className="text-sm font-medium text-slate-300"
              >
                Describe the issue
              </label>
              <Textarea
                id="refund-reason"
                placeholder="e.g. The prompt content could not be decrypted after purchase..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                className="border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-emerald-500/50 focus:ring-emerald-500/20 resize-none"
                disabled={mutation.isPending}
              />
              {reason.trim().length > 0 && reason.trim().length < 10 && (
                <p className="text-xs text-red-400">
                  Please provide at least 10 characters.
                </p>
              )}
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
                className="bg-amber-500 text-slate-950 hover:bg-amber-400 font-bold"
                disabled={mutation.isPending || reason.trim().length < 10}
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting…
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
