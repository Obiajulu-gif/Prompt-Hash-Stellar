import { Router, Request, Response } from "express";
import {
  createWalletSession,
  issueWalletChallenge,
  normalizeWallet,
  walletSessionSecret,
} from "../middleware/walletSession";

/**
 * Wallet sessions for self-service routes — see middleware/walletSession.ts.
 *
 * GET  /api/wallet-session/challenge?walletAddress=  → { token, challenge, expiresAt }
 * POST /api/wallet-session { walletAddress, token, signedMessage } → { sessionToken, expiresAt }
 */
export const walletSessionRouter = Router();

walletSessionRouter.get("/challenge", (req: Request, res: Response) => {
  const secret = walletSessionSecret();
  if (!secret) {
    res.status(503).json({ error: "Wallet sessions are not configured." });
    return;
  }
  const wallet = normalizeWallet(req.query.walletAddress);
  if (!wallet) {
    res.status(400).json({ error: "A valid Stellar walletAddress is required." });
    return;
  }

  const challenge = issueWalletChallenge(secret, wallet);
  res.json({
    token: challenge.token,
    challenge: challenge.challenge,
    expiresAt: challenge.expiresAt,
  });
});

walletSessionRouter.post("/", async (req: Request, res: Response) => {
  const secret = walletSessionSecret();
  if (!secret) {
    res.status(503).json({ error: "Wallet sessions are not configured." });
    return;
  }
  const { walletAddress, token, signedMessage } = req.body ?? {};
  const wallet = normalizeWallet(walletAddress);
  if (!wallet || typeof token !== "string" || typeof signedMessage !== "string") {
    res.status(400).json({ error: "walletAddress, token, and signedMessage are required." });
    return;
  }

  const session = await createWalletSession(secret, wallet, token, signedMessage);
  if (!session) {
    res.status(401).json({ error: "Invalid, expired, or already-used wallet signature." });
    return;
  }
  res.json({ walletAddress: wallet, ...session });
});
