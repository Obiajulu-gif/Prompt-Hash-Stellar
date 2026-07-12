import { ERROR_MESSAGES, type ApiErrorResponse } from "@/lib/api/errorCodes";

export const WALLET_SIGN_IN_PROMPT_ID = "__wallet_sign_in__";

type SignMessageFn = (_message: string) => Promise<{ signedMessage?: string } | string>;

export interface WalletAuthSession {
  address: string;
  authenticated: true;
  expiresAt: number;
}

async function parseApiError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | ApiErrorResponse
    | { error?: string }
    | null;

  if (payload && typeof payload === "object" && "code" in payload && payload.code) {
    return ERROR_MESSAGES[payload.code] ?? payload.error ?? "Wallet authentication failed.";
  }

  if (payload && typeof payload === "object" && "error" in payload && payload.error) {
    return String(payload.error);
  }

  return "Wallet authentication failed.";
}

function extractSignedMessage(signature: { signedMessage?: string } | string): string {
  if (typeof signature === "string") {
    return signature;
  }
  if (!signature?.signedMessage) {
    throw new Error("Wallet did not return a signed message.");
  }
  return signature.signedMessage;
}

async function requestSignInChallenge(address: string) {
  const response = await fetch("/api/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, promptId: WALLET_SIGN_IN_PROMPT_ID }),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  return response.json() as Promise<{
    token: string;
    challenge: string;
    expiresAt: number;
    nonce: string;
  }>;
}

async function verifySignIn(params: {
  address: string;
  token: string;
  signedMessage: string;
}) {
  const response = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...params,
      promptId: WALLET_SIGN_IN_PROMPT_ID,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  return response.json() as Promise<WalletAuthSession>;
}

export async function signInWithWallet(
  address: string,
  signMessage: SignMessageFn,
): Promise<WalletAuthSession> {
  const challenge = await requestSignInChallenge(address);
  const signature = await signMessage(challenge.challenge);

  if (!signature) {
    throw new Error("User declined message signing.");
  }

  return verifySignIn({
    address,
    token: challenge.token,
    signedMessage: extractSignedMessage(signature),
  });
}
