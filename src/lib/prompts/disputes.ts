/**
 * Client for the disputed-purchase resolution endpoints (#755).
 *
 * The buyer view (`fetchDisputeStatus`) is served by an unauthenticated
 * endpoint and never contains wallet, transaction, or maintainer metadata.
 * Maintainer actions require the admin token stored as `adminToken` in local
 * storage, like the reports queue.
 */

export type DisputeStatus =
  | "pending"
  | "delivered"
  | "failed"
  | "retrying"
  | "refund_requested"
  | "refunded"
  | "rejected"
  | "resolved";

export interface DisputeTimelineEntry {
  status: DisputeStatus;
  event: string | null;
  at: string;
}

export interface BuyerDisputeView {
  promptId: string;
  status: DisputeStatus;
  isOpen: boolean;
  refundEligible: boolean;
  unlockAttempts: number;
  retryCount: number;
  failureReason: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  timeline: DisputeTimelineEntry[];
}

export interface MaintainerDisputeView {
  id: string;
  promptId: string;
  buyerWallet: string;
  status: DisputeStatus;
  stale: boolean;
  txHash: string | null;
  disputeTxHash: string | null;
  resolutionTxHash: string | null;
  failureReason: string | null;
  refundReason: string | null;
  resolutionNotes: string | null;
  resolvedBy: string | null;
  unlockAttempts: number;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  lastTransitionAt: string | null;
  timeline: Array<DisputeTimelineEntry & { actor: string | null; note: string }>;
}

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  pending: "Awaiting first unlock",
  delivered: "Delivered",
  failed: "Unlock failed — under review",
  retrying: "Retry ready",
  refund_requested: "Refund requested",
  refunded: "Refunded",
  rejected: "Refund declined",
  resolved: "Resolved",
};

async function throwServerError(res: Response): Promise<never> {
  let message = `Request failed (${res.status}).`;
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") {
      message = body.error;
    }
  } catch {
    // keep the fallback message when the body is not JSON
  }
  throw new Error(message);
}

function adminHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("adminToken") || ""}`,
    // One key per click: a double-submitted action is acknowledged, not re-applied.
    "Idempotency-Key": crypto.randomUUID(),
  };
}

/** Returns `null` when the purchase has no delivery/dispute record. */
export async function fetchDisputeStatus(
  promptId: string,
  buyerWallet: string,
): Promise<BuyerDisputeView | null> {
  const res = await fetch(
    `/api/fulfillment/${encodeURIComponent(promptId)}/${encodeURIComponent(buyerWallet)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) return throwServerError(res);
  const body = (await res.json()) as Partial<BuyerDisputeView> | null;
  return body && typeof body.status === "string" && Array.isArray(body.timeline)
    ? (body as BuyerDisputeView)
    : null;
}

export async function listDisputes(status?: DisputeStatus[]): Promise<MaintainerDisputeView[]> {
  const query = status?.length ? `?status=${status.join(",")}` : "";
  const res = await fetch(`/api/fulfillment/disputes${query}`, {
    headers: adminHeaders(),
  });
  if (!res.ok) return throwServerError(res);
  const body = (await res.json()) as { disputes: MaintainerDisputeView[] };
  return body.disputes;
}

async function postDisputeAction(
  dispute: Pick<MaintainerDisputeView, "promptId" | "buyerWallet">,
  action: "retry" | "resolve" | "close",
  body: Record<string, unknown>,
): Promise<MaintainerDisputeView> {
  const res = await fetch(
    `/api/fulfillment/${encodeURIComponent(dispute.promptId)}/${encodeURIComponent(
      dispute.buyerWallet,
    )}/${action}`,
    { method: "POST", headers: adminHeaders(), body: JSON.stringify(body) },
  );
  if (!res.ok) return throwServerError(res);
  return res.json();
}

export function retryDisputeUnlock(
  dispute: Pick<MaintainerDisputeView, "promptId" | "buyerWallet">,
  notes?: string,
) {
  return postDisputeAction(dispute, "retry", { notes });
}

export function approveDisputeRefund(
  dispute: Pick<MaintainerDisputeView, "promptId" | "buyerWallet">,
  notes?: string,
  resolutionTxHash?: string,
) {
  return postDisputeAction(dispute, "resolve", { refund: true, notes, resolutionTxHash });
}

export function rejectDisputeRefund(
  dispute: Pick<MaintainerDisputeView, "promptId" | "buyerWallet">,
  notes?: string,
) {
  return postDisputeAction(dispute, "resolve", { refund: false, notes });
}

export function closeDispute(
  dispute: Pick<MaintainerDisputeView, "promptId" | "buyerWallet">,
  notes: string,
) {
  return postDisputeAction(dispute, "close", { notes });
}
