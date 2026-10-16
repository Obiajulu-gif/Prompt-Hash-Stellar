/**
 * AuthProvider — Stellar wallet authentication context.
 *
 * Manages the full nonce → sign → verify session lifecycle:
 *  1. `authenticate(address, signMessage)` fetches a nonce from
 *     GET /api/auth/nonce, asks the wallet to sign the challenge message,
 *     then POSTs to /api/auth/verify to receive a JWT.
 *  2. The JWT is stored in memory (plus an HTTP-only cookie set by the server).
 *  3. On page load the provider auto-rehydrates from the cookie by calling
 *     GET /api/auth/me (which validates the cookie server-side).
 *  4. `logout()` calls POST /api/auth/logout to clear the cookie.
 *
 * Separate from WalletProvider — WalletProvider handles the raw wallet
 * connection (address + signing), AuthProvider handles the backend session.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AuthContextType,
  AuthSession,
  AuthStatus,
} from "../lib/auth/stellarAuth";

// ─── Context ──────────────────────────────────────────────────────────────────

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchNonce(address: string): Promise<{
  nonce: string;
  message: string;
  expiresAt: number;
  issuedAt: number;
}> {
  const res = await fetch(
    `/api/auth/nonce?address=${encodeURIComponent(address)}`,
    { method: "GET" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `Failed to fetch nonce (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}

async function postVerify(
  address: string,
  nonce: string,
  signature: string,
): Promise<{ token: string; address: string; expiresAt: number }> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // ensure the HTTP-only cookie is received
    body: JSON.stringify({ address, nonce, signature }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `Verification failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}

async function fetchMe(): Promise<{
  address: string;
  expiresAt: number;
} | null> {
  try {
    const res = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "include",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function postLogout(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
}

// ─── Signature extraction helper (mirrors unlock.ts pattern) ─────────────────

function extractSignedMessage(
  result: { signedMessage?: string } | string,
): string {
  if (typeof result === "string") return result;
  if (result?.signedMessage) return result.signedMessage;
  throw new Error("Wallet did not return a signed message.");
}

// ─── Provider ────────────────────────────────────────────────────────────────

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Auto-rehydrate on mount ───────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const rehydrate = async () => {
      const me = await fetchMe();
      if (cancelled) return;

      if (me) {
        // Server confirmed the HTTP-only cookie is valid; we don't have the
        // raw JWT in memory (it's in the cookie), so store a sentinel token.
        setSession({
          address: me.address,
          token: "cookie", // flag: actual JWT is in the HTTP-only cookie
          expiresAt: me.expiresAt,
        });
        setStatus("authenticated");
      } else {
        setStatus("unauthenticated");
      }
    };

    void rehydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── authenticate ──────────────────────────────────────────────────────────

  const authenticate = useCallback(
    async (
      address: string,
      signMessage: (msg: string) => Promise<{ signedMessage?: string } | string>,
    ) => {
      setStatus("authenticating");
      setError(null);

      try {
        // 1. Request nonce from backend
        const { nonce, message } = await fetchNonce(address);

        // 2. Ask wallet to sign the challenge message
        let signResult: { signedMessage?: string } | string;
        try {
          signResult = await signMessage(message);
        } catch (signErr) {
          const msg =
            signErr instanceof Error ? signErr.message : "Wallet signing was declined.";
          throw new Error(msg);
        }

        if (!signResult) {
          throw new Error("Wallet did not return a signature.");
        }

        const signature = extractSignedMessage(signResult);

        // 3. Verify signature on backend → receive JWT
        const verified = await postVerify(address, nonce, signature);

        setSession({
          address: verified.address,
          token: verified.token,
          expiresAt: verified.expiresAt,
        });
        setStatus("authenticated");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Authentication failed.";
        setError(message);
        setStatus("error");
        throw err; // re-throw so the caller can show UI feedback
      }
    },
    [],
  );

  // ── logout ────────────────────────────────────────────────────────────────

  const logout = useCallback(async () => {
    try {
      await postLogout();
    } catch {
      // Ignore logout errors — always clear local state
    }
    setSession(null);
    setError(null);
    setStatus("unauthenticated");
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  const isAuthenticated =
    status === "authenticated" &&
    session !== null &&
    session.expiresAt > Date.now();

  const value = useMemo<AuthContextType>(
    () => ({
      status,
      session,
      error,
      authenticate,
      logout,
      isAuthenticated,
    }),
    [status, session, error, authenticate, logout, isAuthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ─── Consumer hook ────────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
