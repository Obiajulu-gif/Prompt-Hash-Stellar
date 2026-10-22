/*
 * Wallet-session authentication for self-service routes (buyer library #784,
 * creator provenance declarations #753).
 *
 *  1. GET  /api/wallet-session/challenge?walletAddress=G…  issues a challenge.
 *  2. The wallet signs it; POST /api/wallet-session verifies the signature,
 *     consumes the nonce, and returns a short-lived session token.
 *  3. Protected routes send `Authorization: Bearer <session token>`, and are
 *     admitted only for the wallet the token was issued to.
 *
 * Tokens reuse the HMAV challenge-token format from src/lib/auth/challenge.ts
 * (signed with CHALLENGE_TOKEN_SECRET) under dedicated actions, so an unlock
 * challenge can never be replayed as a session, and vice versa.
 */

import { Request, Response, NextFunction } from "express";
import {
  buildChallengeMessage,
  createChallengeToken,
  globalNonceLedger,
  verifyChallengeSignature,
  verifyChallengeToken,
} from "../../../src/lib/auth/challenge";
import { globalSessionRevocationRegistry } from "../services/sessionRevocationService";
import { redactLogFields, safeLog } from "../services/secureLogger";

const SESSION_SUBJECT = "wallet-session";
const CHALLENGE_ACTION = "wallet_session_challenge";
const SESSION_ACTION = "wallet_session";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const WALLET_SESSION_TTL_MS = 30 * 60 * 1000;

export interface WalletSessionRequest extends Request {
  /** Wallet proven by the session token (uppercase G… address). */
  sessionWallet?: string;
}

export function walletSessionSecret(): string | null {
  const secret = process.env.CHALLENGE_TOKEN_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

/** Stellar account IDs are upper-case; stored copies are often lower-cased. */
export function normalizeWallet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const wallet = value.trim().toUpperCase();
  return /^G[A-Z2-7]{56}$/.test(wallet) ? wallet : null;
}

export function issueWalletChallenge(secret: string, walletAddress: string) {
  return createChallengeToken(secret, walletAddress, SESSION_SUBJECT, Date.now(), CHALLENGE_TTL_MS, {
    action: CHALLENGE_ACTION,
  });
}

/**
 * Verifies a signed session challenge and returns a session token, or `null`
 * if the token, signature, or nonce is invalid.
 */
export async function createWalletSession(
  secret: string,
  walletAddress: string,
  token: string,
  signedMessage: string,
): Promise<{ sessionToken: string; expiresAt: number } | null> {
  try {
    const payload = verifyChallengeToken(secret, token, walletAddress, SESSION_SUBJECT, Date.now(), {
      action: CHALLENGE_ACTION,
    });
    if (!verifyChallengeSignature(walletAddress, buildChallengeMessage(payload), signedMessage)) {
      safeLog("warn", "wallet_session.signature_rejected", {
        walletAddress,
        action: CHALLENGE_ACTION,
      });
      return null;
    }
    if (!(await globalNonceLedger.consume(payload.nonce, payload.expiresAt))) {
      safeLog("warn", "wallet_session.nonce_rejected", {
        walletAddress,
        action: CHALLENGE_ACTION,
      });
      return null;
    }
  } catch {
    safeLog("warn", "wallet_session.verification_failed", {
      walletAddress,
      action: CHALLENGE_ACTION,
    });
    return null;
  }

  const session = createChallengeToken(
    secret,
    walletAddress,
    SESSION_SUBJECT,
    Date.now(),
    WALLET_SESSION_TTL_MS,
    { action: SESSION_ACTION },
  );
  safeLog("info", "wallet_session.created", {
    walletAddress,
    expiresAt: session.expiresAt,
  });
  return { sessionToken: session.token, expiresAt: session.expiresAt };
}

/**
 * Express middleware factory. `walletOf` picks the wallet the request acts
 * for (a route param or body field); the bearer session must belong to it.
 */
export function requireWalletSession(walletOf: (req: Request) => unknown) {
  return function walletSessionMiddleware(
    req: WalletSessionRequest,
    res: Response,
    next: NextFunction,
  ): void {
    const secret = walletSessionSecret();
    if (!secret) {
      safeLog("error", "wallet_session.not_configured", {
        path: req.path,
        method: req.method,
      });
      res.status(503).json({ error: "Wallet sessions are not configured." });
      return;
    }

    const wallet = normalizeWallet(walletOf(req));
    if (!wallet) {
      safeLog("warn", "wallet_session.invalid_wallet", {
        path: req.path,
        method: req.method,
      });
      res.status(400).json({ error: "A valid Stellar wallet address is required." });
      return;
    }

    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    let payload;
    try {
      payload = verifyChallengeToken(secret, token, wallet, SESSION_SUBJECT, Date.now(), {
        action: SESSION_ACTION,
      });
    } catch {
      safeLog("warn", "wallet_session.token_rejected", {
        walletAddress: wallet,
        path: req.path,
        method: req.method,
      });
      res.status(401).json({ error: "A valid wallet session for this wallet is required." });
      return;
    }

    const revocation = globalSessionRevocationRegistry.isRevoked(
      wallet,
      payload.issuedAt,
      payload.nonce,
    );
    if (revocation.revoked) {
      // User-safe message only: the internal revocation reason stays server-side.
      safeLog("warn", "wallet_session.revoked", {
        walletAddress: wallet,
        code: revocation.code,
        path: req.path,
        method: req.method,
      });
      res.status(401).json({
        error: revocation.message,
        code: revocation.code,
      });
      return;
    }

    req.sessionWallet = wallet;
    safeLog("warn", "wallet_session.authenticated", {
      walletAddress: wallet,
      path: req.path,
      method: req.method,
    });
    next();
  };
}

/** Max age of a wallet session accepted as proof of a recent signature (step-up). */
export const STEP_UP_MAX_SESSION_AGE_MS = 5 * 60 * 1000;

/**
 * True when the request carries a valid wallet session for `wallet` that was
 * issued (i.e. freshly signed) within `maxAgeMs`. Used as the step-up proof
 * for risk-scored operations: an old session is not enough, the wallet must
 * have signed a new challenge recently.
 */
export function hasFreshWalletSession(
  req: Request,
  wallet: string,
  maxAgeMs: number = STEP_UP_MAX_SESSION_AGE_MS,
  now: number = Date.now(),
): boolean {
  const secret = walletSessionSecret();
  const normalized = normalizeWallet(wallet);
  if (!secret || !normalized) return false;
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  try {
    const payload = verifyChallengeToken(secret, token, normalized, SESSION_SUBJECT, now, {
      action: SESSION_ACTION,
    });
    if (globalSessionRevocationRegistry.isRevoked(normalized, payload.issuedAt, payload.nonce, now).revoked) {
      return false;
    }
    return now - payload.issuedAt <= maxAgeMs;
  } catch {
    return false;
  }
}

/** Re-exported for consumers that need to redact arbitrary log fields. */
export { redactLogFields };
