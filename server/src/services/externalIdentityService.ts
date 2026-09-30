import { createHash } from "crypto";
import ExternalIdentityLink, { type IExternalIdentityLink } from "../models/ExternalIdentityLink";
import { recordAuditEvent } from "./auditTrail";

export const IDENTITY_VERIFICATION_METHOD = "wallet_signature";

export class ExternalIdentityError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ExternalIdentityError";
  }
}

export function normalizeProvider(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const provider = value.trim().toLowerCase();
  return /^[a-z][a-z0-9._-]{1,63}$/.test(provider) ? provider : null;
}

export function normalizeSubject(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const subject = value.trim();
  if (!subject || subject.length > 256 || /[\u0000-\u001f\u007f]/u.test(subject)) return null;
  return subject;
}

export function identityChallengeId(provider: string, subject: string): string {
  return `external_identity:${provider}:${createHash("sha256").update(subject).digest("hex")}`;
}

export function digestVerification(provider: string, subject: string, challenge: string, signature: string): string {
  return createHash("sha256")
    .update(`${provider}|${subject}|${challenge}|${signature}`)
    .digest("hex");
}

export async function linkExternalIdentity(params: {
  walletAddress: string;
  provider: string;
  subject: string;
  challenge: string;
  signature: string;
  requestId?: string | null;
  clientIp?: string | null;
}): Promise<IExternalIdentityLink> {
  const now = new Date();
  const existingSubject = await ExternalIdentityLink.findOne({
    provider: params.provider,
    subject: params.subject,
    status: "active",
  }).lean();
  if (existingSubject) {
    await recordAuditEvent({
      action: "identity_link",
      result: "blocked",
      walletAddress: params.walletAddress,
      target: `${params.provider}:${params.subject}`,
      targetType: "external_identity",
      requestId: params.requestId,
      clientIp: params.clientIp,
      reason: "identity_already_linked",
    });
    throw new ExternalIdentityError(409, "This external identity is already linked.");
  }

  const existingProvider = await ExternalIdentityLink.findOne({
    walletAddress: params.walletAddress.toLowerCase(),
    provider: params.provider,
    status: "active",
  }).lean();
  if (existingProvider) {
    throw new ExternalIdentityError(409, "An active identity for this provider is already linked.");
  }

  try {
    const link = await ExternalIdentityLink.create({
      walletAddress: params.walletAddress,
      provider: params.provider,
      subject: params.subject,
      status: "active",
      verificationMethod: IDENTITY_VERIFICATION_METHOD,
      verificationHash: digestVerification(params.provider, params.subject, params.challenge, params.signature),
      verifiedAt: now,
      linkedAt: now,
    });
    await recordAuditEvent({
      action: "identity_link",
      result: "success",
      walletAddress: params.walletAddress,
      target: `${params.provider}:${params.subject}`,
      targetType: "external_identity",
      afterState: { status: "active", verificationMethod: IDENTITY_VERIFICATION_METHOD },
      requestId: params.requestId,
      clientIp: params.clientIp,
      reason: "verified_wallet_signature",
    });
    return link;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new ExternalIdentityError(409, "This external identity is already linked.");
    }
    throw error;
  }
}

export async function unlinkExternalIdentity(params: {
  walletAddress: string;
  provider: string;
  subject: string;
  reason?: string;
  requestId?: string | null;
  clientIp?: string | null;
}): Promise<void> {
  const current = await ExternalIdentityLink.findOne({
    walletAddress: params.walletAddress.toLowerCase(),
    provider: params.provider,
    subject: params.subject,
    status: "active",
  });
  if (!current) {
    await recordAuditEvent({
      action: "identity_unlink",
      result: "blocked",
      walletAddress: params.walletAddress,
      target: `${params.provider}:${params.subject}`,
      targetType: "external_identity",
      requestId: params.requestId,
      clientIp: params.clientIp,
      reason: "identity_not_owned_or_active",
    });
    throw new ExternalIdentityError(404, "Active linked identity not found.");
  }

  current.status = "unlinked";
  current.unlinkedAt = new Date();
  current.unlinkReason = params.reason?.trim().slice(0, 500) || "user_requested";
  await current.save();
  await recordAuditEvent({
    action: "identity_unlink",
    result: "success",
    walletAddress: params.walletAddress,
    target: `${params.provider}:${params.subject}`,
    targetType: "external_identity",
    beforeState: { status: "active" },
    afterState: { status: "unlinked", reason: current.unlinkReason },
    requestId: params.requestId,
    clientIp: params.clientIp,
    reason: "user_requested",
  });
}

export async function listExternalIdentities(walletAddress: string) {
  return ExternalIdentityLink.find({ walletAddress: walletAddress.toLowerCase(), status: "active" })
    .select("provider subject status verificationMethod verifiedAt linkedAt")
    .sort({ linkedAt: 1 })
    .lean();
}
