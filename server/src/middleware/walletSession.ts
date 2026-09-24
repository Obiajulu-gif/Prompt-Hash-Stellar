/**
 * Wallet-session authentication for self-service routes (buyer library #784,
 * creator provenance declarations #753).
 *
 *  1. GET  /api/wallet-session/challenge?walletAddress=G…  issues a challenge.
 *  2. The wallet signs it; POST /api/wallet-session verifies the signature,
 *     consumes the nonce, and returns a short-lived session token.
 *  3. Protected routes send `Authorization: Bearer <session token>` and are
 *     admitted only for the wallet the token was issued to.
 *
 * Tokens reuse the HMAC challenge-token format from src/lib/auth/challenge.ts
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
  return /^G[A-Z2-7]{55}$/.test(wallet) ? wallet : null;
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
      return null;
    }
    if (!(await globalNonceLedger.consume(payload.nonce, payload.expiresAt))) {
      return null;
    }
  } catch {
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
      res.status(503).json({ error: "Wallet sessions are not configured." });
      return;
    }

    const wallet = normalizeWallet(walletOf(req));
    if (!wallet) {
      res.status(400).json({ error: "A valid Stellar wallet address is required." });
      return;
    }

    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    try {
      verifyChallengeToken(secret, token, wallet, SESSION_SUBJECT, Date.now(), {
        action: SESSION_ACTION,
      });
    } catch {
      res.status(401).json({ error: "A valid wallet session for this wallet is required." });
      return;
    }

    req.sessionWallet = wallet;
    next();
  };
}
