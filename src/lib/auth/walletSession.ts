/**
 * Client for wallet sessions (see server/src/middleware/walletSession.ts).
 *
 * The buyer library (#784) and creator provenance declarations (#753) need
 * proof that the caller controls a wallet. One signed challenge buys a
 * short-lived session token, cached per wallet in sessionStorage so the
 * wallet is not asked to sign on every request.
 */

type SignMessageFn = (_message: string) => Promise<{ signedMessage?: string } | string>;

interface StoredSession {
  sessionToken: string;
  expiresAt: number;
}

const STORAGE_PREFIX = "prompthash:wallet-session:";
/** Refresh a little early so a request never races the expiry. */
const EXPIRY_MARGIN_MS = 60_000;

function storageKey(walletAddress: string): string {
  return `${STORAGE_PREFIX}${walletAddress.toUpperCase()}`;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || fallback;
}

/** Returns a cached, unexpired session token without prompting the wallet. */
export function peekWalletSession(walletAddress: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(walletAddress));
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    return session.expiresAt - EXPIRY_MARGIN_MS > Date.now() ? session.sessionToken : null;
  } catch {
    return null;
  }
}

export function clearWalletSession(walletAddress: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(walletAddress));
  } catch {
    // storage may be unavailable (private browsing)
  }
}

/**
 * Returns a session token for `walletAddress`, asking the wallet to sign a
 * fresh challenge only when there is no valid cached session.
 */
export async function getWalletSession(
  walletAddress: string,
  signMessage: SignMessageFn,
): Promise<string> {
  const cached = peekWalletSession(walletAddress);
  if (cached) return cached;

  const challengeResponse = await fetch(
    `/api/wallet-session/challenge?walletAddress=${encodeURIComponent(walletAddress)}`,
  );
  if (!challengeResponse.ok) {
    throw new Error(await errorMessage(challengeResponse, "Could not start wallet verification."));
  }
  const { token, challenge } = (await challengeResponse.json()) as {
    token: string;
    challenge: string;
  };

  const signature = await signMessage(challenge);
  const signedMessage = typeof signature === "string" ? signature : signature?.signedMessage;
  if (!signedMessage) {
    throw new Error("User declined message signing.");
  }

  const sessionResponse = await fetch("/api/wallet-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, token, signedMessage }),
  });
  if (!sessionResponse.ok) {
    throw new Error(await errorMessage(sessionResponse, "Wallet verification failed."));
  }
  const session = (await sessionResponse.json()) as StoredSession;

  try {
    window.sessionStorage.setItem(storageKey(walletAddress), JSON.stringify(session));
  } catch {
    // storage may be unavailable; the token still works for this call
  }
  return session.sessionToken;
}
