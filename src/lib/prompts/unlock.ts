import { ERROR_MESSAGES, type ApiErrorResponse } from "@/lib/api/errorCodes";
import { hashPromptPlaintext } from "@/lib/crypto/promptCrypto";

type SignMessageFn = (message: string) => Promise<{ signedMessage?: string } | string>;

export interface UnlockResult {
  promptId: string;
  title: string;
  contentHash: string;
  plaintext: string;
  decryptedContent: string;
}

async function parseApiError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | ApiErrorResponse
    | { error?: string }
    | null;

  if (payload && typeof payload === "object" && "code" in payload && payload.code) {
    const code = payload.code as keyof typeof ERROR_MESSAGES;
    return ERROR_MESSAGES[code] ?? payload.error ?? "Failed to unlock prompt.";
  }

  if (payload && typeof payload === "object" && "error" in payload && payload.error) {
    return String(payload.error);
  }

  return "Failed to unlock prompt.";
}

function extractSignedMessage(
  signature: { signedMessage?: string } | string,
): string {
  if (typeof signature === "string") {
    return signature;
  }
  if (!signature?.signedMessage) {
    throw new Error("Wallet did not return a signed message.");
  }
  return signature.signedMessage;
}

async function requestChallenge(address: string, promptId: string) {
  const response = await fetch("/api/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, promptId }),
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

async function requestUnlock(params: {
  token: string;
  promptId: string;
  address: string;
  signedMessage: string;
}) {
  const response = await fetch("/api/prompts/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  return response.json() as Promise<{
    promptId: string;
    title: string;
    contentHash: string;
    plaintext: string;
  }>;
}

function normalizePromptId(promptId: string | bigint | number): string {
  return typeof promptId === "bigint" ? promptId.toString() : String(promptId);
}

/**
 * Unlock a purchased prompt via challenge → wallet sign → unlock API.
 * Re-verifies the returned plaintext hash client-side when contentHash is present.
 */
export async function unlockPromptContent(
  address: string,
  promptId: string | bigint | number,
  signMessage: SignMessageFn,
): Promise<UnlockResult> {
  const id = normalizePromptId(promptId);

  const challenge = await requestChallenge(address, id);
  const signature = await signMessage(challenge.challenge);

  if (!signature) {
    throw new Error("User declined message signing.");
  }

  const signedMessage = extractSignedMessage(signature);
  const unlocked = await requestUnlock({
    token: challenge.token,
    promptId: id,
    address,
    signedMessage,
  });

  const recomputedHash = await hashPromptPlaintext(unlocked.plaintext);
  if (unlocked.contentHash && recomputedHash !== unlocked.contentHash.toLowerCase()) {
    throw new Error(ERROR_MESSAGES.INTEGRITY_FAILURE);
  }

  return {
    ...unlocked,
    decryptedContent: unlocked.plaintext,
  };
}

/** @deprecated Use unlockPromptContent — txHash is ignored; access is verified on-chain. */
export async function unlockPrompt(
  itemId: string,
  _txHash: string,
  signMessage: SignMessageFn,
  address?: string,
): Promise<{ decryptedContent: string; plaintext: string }> {
  if (!address) {
    throw new Error("Connect a Stellar wallet before unlocking.");
  }

  const result = await unlockPromptContent(address, itemId, signMessage);
  return {
    decryptedContent: result.plaintext,
    plaintext: result.plaintext,
  };
}
