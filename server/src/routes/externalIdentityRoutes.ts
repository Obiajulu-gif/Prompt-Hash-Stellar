import { Router, type Request, type Response } from "express";
import connectDb from "../db/connectDb";
import {
  buildChallengeMessage,
  createChallengeToken,
  globalNonceLedger,
  verifyChallengeSignature,
  verifyChallengeToken,
} from "../../../src/lib/auth/challenge";
import { requireIdempotency } from "../middleware/idempotency";
import { requireWalletSession, type WalletSessionRequest, normalizeWallet, walletSessionSecret } from "../middleware/walletSession";
import {
  ExternalIdentityError,
  identityChallengeId,
  linkExternalIdentity,
  listExternalIdentities,
  normalizeProvider,
  normalizeSubject,
  unlinkExternalIdentity,
} from "../services/externalIdentityService";
import { recordAuditEvent } from "../services/auditTrail";

export const externalIdentityRouter = Router();
const CHALLENGE_ACTION = "external_identity_link";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function identityInput(body: unknown): { provider: string; subject: string } | null {
  const input = body as { provider?: unknown; subject?: unknown } | null;
  const provider = normalizeProvider(input?.provider);
  const subject = normalizeSubject(input?.subject);
  return provider && subject ? { provider, subject } : null;
}

function identityError(res: Response, error: unknown): void {
  if (error instanceof ExternalIdentityError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  throw error;
}

externalIdentityRouter.post(
  "/challenge",
  requireWalletSession((req: Request) => req.body?.walletAddress),
  (req: WalletSessionRequest, res: Response) => {
    const input = identityInput(req.body);
    const secret = walletSessionSecret();
    if (!secret) {
      res.status(503).json({ error: "Wallet sessions are not configured." });
      return;
    }
    if (!input) {
      res.status(400).json({ error: "provider and subject are required." });
      return;
    }
    const challenge = createChallengeToken(
      secret,
      req.sessionWallet!,
      identityChallengeId(input.provider, input.subject),
      Date.now(),
      CHALLENGE_TTL_MS,
      { action: CHALLENGE_ACTION },
    );
    res.json({ token: challenge.token, challenge: challenge.challenge, expiresAt: challenge.expiresAt });
  },
);

externalIdentityRouter.get(
  "/",
  requireWalletSession((req: Request) => req.headers["x-wallet-address"]),
  async (req: WalletSessionRequest, res: Response) => {
    await connectDb();
    res.json({ identities: await listExternalIdentities(req.sessionWallet!) });
  },
);

externalIdentityRouter.post(
  "/",
  requireIdempotency,
  requireWalletSession((req: Request) => req.body?.walletAddress),
  async (req: WalletSessionRequest, res: Response) => {
    const input = identityInput(req.body);
    const secret = walletSessionSecret();
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const signedMessage = typeof req.body?.signedMessage === "string" ? req.body.signedMessage : "";
    if (!input || !secret || !token || !signedMessage) {
      res.status(400).json({ error: "provider, subject, token, and signedMessage are required." });
      return;
    }

    try {
      const payload = verifyChallengeToken(
        secret,
        token,
        req.sessionWallet!,
        identityChallengeId(input.provider, input.subject),
        Date.now(),
        { action: CHALLENGE_ACTION },
      );
      if (!verifyChallengeSignature(req.sessionWallet!, buildChallengeMessage(payload), signedMessage)) {
        await recordAuditEvent({
          action: "identity_link",
          result: "failure",
          walletAddress: req.sessionWallet,
          target: `${input.provider}:${input.subject}`,
          targetType: "external_identity",
          requestId: req.correlationId,
          clientIp: req.ip,
          reason: "invalid_wallet_signature",
        });
        res.status(401).json({ error: "Identity verification failed." });
        return;
      }
      if (!(await globalNonceLedger.consume(payload.nonce, payload.expiresAt))) {
        await recordAuditEvent({
          action: "identity_link",
          result: "blocked",
          walletAddress: req.sessionWallet,
          target: `${input.provider}:${input.subject}`,
          targetType: "external_identity",
          requestId: req.correlationId,
          clientIp: req.ip,
          reason: "verification_replay",
        });
        res.status(409).json({ error: "This verification challenge has already been used." });
        return;
      }

      await connectDb();
      const link = await linkExternalIdentity({
        walletAddress: req.sessionWallet!,
        provider: input.provider,
        subject: input.subject,
        challenge: [payload.action, payload.address, payload.promptId, payload.nonce, payload.expiresAt].join(":"),
        signature: signedMessage,
        requestId: req.correlationId,
        clientIp: req.ip,
      });
      res.status(201).json({
        identity: {
          provider: link.provider,
          subject: link.subject,
          status: link.status,
          verificationMethod: link.verificationMethod,
          verifiedAt: link.verifiedAt,
          linkedAt: link.linkedAt,
        },
      });
    } catch (error) {
      identityError(res, error);
    }
  },
);

externalIdentityRouter.delete(
  "/:provider/:subject",
  requireIdempotency,
  requireWalletSession((req: Request) => req.headers["x-wallet-address"]),
  async (req: WalletSessionRequest, res: Response) => {
    const provider = normalizeProvider(req.params.provider);
    const subject = normalizeSubject(req.params.subject);
    if (!provider || !subject || req.body?.confirm !== true) {
      res.status(400).json({ error: "A valid provider, subject, and confirm=true are required." });
      return;
    }
    try {
      await connectDb();
      await unlinkExternalIdentity({
        walletAddress: req.sessionWallet!,
        provider,
        subject,
        reason: req.body?.reason,
        requestId: req.correlationId,
        clientIp: req.ip,
      });
      res.status(204).end();
    } catch (error) {
      identityError(res, error);
    }
  },
);
