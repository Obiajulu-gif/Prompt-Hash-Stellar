import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { Request } from "express";
import ApiKey, { type ApiKeyScope } from "../models/ApiKey";

const API_KEY_PREFIX = "phs";

export interface IssuedApiKey {
  id: string;
  secret: string;
  name: string;
  scopes: ApiKeyScope[];
  createdAt: Date;
}

export interface AuthenticatedApiKey {
  id: string;
  walletAddress: string;
  scopes: ApiKeyScope[];
}

function hashKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function keyHashHex(secret: string): string {
  return hashKey(secret).toString("hex");
}

function makeSecret(keyId: string): string {
  return `${API_KEY_PREFIX}_${keyId}_${randomBytes(32).toString("base64url")}`;
}

function parseSecret(secret: string): { keyId: string } | null {
  const match = /^phs_([a-f0-9]{16})_[A-Za-z0-9_-]{43}$/.exec(secret);
  return match ? { keyId: match[1] } : null;
}

function publicKey(document: any) {
  return {
    id: document.keyId,
    prefix: document.keyPrefix,
    name: document.name,
    scopes: document.scopes,
    createdAt: document.createdAt,
    revokedAt: document.revokedAt,
    expiresAt: document.expiresAt,
    lastUsedAt: document.lastUsedAt,
    lastUsedIp: document.lastUsedIp,
    lastUsedUserAgent: document.lastUsedUserAgent,
    usageCount: document.usageCount,
    replacedByKeyId: document.replacedByKeyId,
  };
}

export async function issueApiKey(input: {
  walletAddress: string;
  name: string;
  scopes: ApiKeyScope[];
}): Promise<IssuedApiKey> {
  const keyId = randomBytes(8).toString("hex");
  const secret = makeSecret(keyId);
  const document = await ApiKey.create({
    keyId,
    keyHash: keyHashHex(secret),
    keyPrefix: `${API_KEY_PREFIX}_${keyId}`,
    walletAddress: input.walletAddress.toLowerCase(),
    name: input.name.trim(),
    scopes: input.scopes,
  });

  return {
    id: document.keyId,
    secret,
    name: document.name,
    scopes: document.scopes,
    createdAt: document.createdAt,
  };
}

export async function listApiKeys(walletAddress: string) {
  const documents = await ApiKey.find({ walletAddress: walletAddress.toLowerCase() })
    .select("-keyHash")
    .sort({ createdAt: -1 })
    .lean();
  return documents.map(publicKey);
}

export async function revokeApiKey(walletAddress: string, keyId: string) {
  return ApiKey.findOneAndUpdate(
    { keyId, walletAddress: walletAddress.toLowerCase(), revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true },
  )
    .select("-keyHash")
    .lean();
}

export async function rotateApiKey(walletAddress: string, keyId: string, name?: string) {
  const current = await ApiKey.findOne({
    keyId,
    walletAddress: walletAddress.toLowerCase(),
    revokedAt: null,
  }).select("+keyHash");

  if (!current) return null;

  const replacement = await issueApiKey({
    walletAddress,
    name: name?.trim() || current.name,
    scopes: current.scopes as ApiKeyScope[],
  });

  await ApiKey.updateOne(
    { _id: current._id, revokedAt: null },
    { $set: { revokedAt: new Date(), replacedByKeyId: replacement.id } },
  );

  return replacement;
}

export async function authenticateApiKey(secret: string, req: Request): Promise<AuthenticatedApiKey | null> {
  const parsed = parseSecret(secret);
  if (!parsed) return null;

  const expectedHash = hashKey(secret);
  const document = await ApiKey.findOne({
    keyId: parsed.keyId,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).select("+keyHash");

  if (!document) return null;
  const storedHash = Buffer.from(document.keyHash, "hex");
  if (storedHash.length !== expectedHash.length || !timingSafeEqual(storedHash, expectedHash)) {
    return null;
  }

  await ApiKey.updateOne(
    { _id: document._id, revokedAt: null },
    {
      $set: {
        lastUsedAt: new Date(),
        lastUsedIp: req.ip || req.socket.remoteAddress || null,
        lastUsedUserAgent: req.get("user-agent")?.slice(0, 500) || null,
      },
      $inc: { usageCount: 1 },
    },
  );

  return {
    id: document.keyId,
    walletAddress: document.walletAddress,
    scopes: document.scopes as ApiKeyScope[],
  };
}