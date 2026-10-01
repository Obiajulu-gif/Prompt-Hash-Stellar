/**
 * Client for the OFF-CHAIN ownership transfer endpoints (#708).
 *
 * The Soroban contract's `Prompt.creator` is immutable; transfers only
 * re-point the indexed `Prompt.owner` after the recipient approves (or
 * rejects) a wallet-signature-gated request. See docs/architecture.md.
 */

export type OwnershipTransferStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export interface OwnershipTransferDto {
  id: string;
  promptId: string;
  promptTitle: string;
  fromWallet: string;
  toWallet: string;
  status: OwnershipTransferStatus;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface OwnershipTransferList {
  inbound: OwnershipTransferDto[];
  outbound: OwnershipTransferDto[];
}

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

export async function listOwnershipTransfers(
  walletAddress: string,
): Promise<OwnershipTransferList> {
  const res = await fetch(
    `/api/prompts/transfers/${encodeURIComponent(walletAddress)}`,
  );
  if (!res.ok) return throwServerError(res);
  return res.json();
}

export async function requestOwnershipTransfer(input: {
  promptId: string;
  fromWallet: string;
  toWallet: string;
  signature: string;
}): Promise<OwnershipTransferDto> {
  const res = await fetch("/api/prompts/transfers/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return throwServerError(res);
  return res.json();
}

export async function respondOwnershipTransfer(
  transferId: string,
  input: {
    walletAddress: string;
    decision: "approved" | "rejected";
    signature: string;
  },
): Promise<OwnershipTransferDto> {
  const res = await fetch(
    `/api/prompts/transfers/${encodeURIComponent(transferId)}/respond`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) return throwServerError(res);
  return res.json();
}

export async function cancelOwnershipTransfer(
  transferId: string,
  input: { walletAddress: string; signature: string },
): Promise<OwnershipTransferDto> {
  const res = await fetch(
    `/api/prompts/transfers/${encodeURIComponent(transferId)}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) return throwServerError(res);
  return res.json();
}