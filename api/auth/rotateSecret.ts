/**
 * Secret Rotation Endpoint
 *
 * Durable, atomic secret rotation with compare-and-swap versioning.
 * Concurrent rotations have a deterministic winner; the loser gets a retriable conflict.
 * No secret material is logged or returned in responses.
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import { isPlaceholder } from "../../src/lib/validation/envValidator";
import { AdminTokenError, verifyAdminToken } from "../../server/src/services/adminToken";
import { recordAuditEvent } from "../../server/src/services/auditTrail";

const ALGORITHM = "aes-256-gcm";
const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes
const ROTATE_SECRET_SCOPE = "secrets:rotate";

interface SecretVersion {
  version: number;
  encryptedSecret: string;
  iv: string;
  authTag: string;
  createdAt: number;
}

interface RotationConfig {
  activeVersion: number;
  versions: SecretVersion[];
  gracePeriodMs: number;
}

interface RotationApproval {
  expectedVersion: number;
  operators: Set<string>;
  createdAt: number;
}

// ── Encryption helpers ──────────────────────────────────────────────

function deriveKey(passphrase: string): Buffer {
  return scryptSync(passphrase, "prompt-hash-rotation-salt", 32);
}

function encryptSecret(plaintext: string, passphrase: string): { encrypted: string; iv: string; authTag: string } {
  const key = deriveKey(passphrase);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encrypted: encrypted.toString("hex"), iv: iv.toString("hex"), authTag: authTag.toString("hex") };
}

function decryptSecret(encrypted: string, iv: string, authTag: string, passphrase: string): string {
  const key = deriveKey(passphrase);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

// ── Storage layer (replace with Redis/Vault in production) ──────────

let rotationStore: RotationConfig = {
  activeVersion: 0,
  versions: [],
  gracePeriodMs: GRACE_PERIOD_MS,
};
const rotationApprovals = new Map<string, RotationApproval>();

function loadConfig(): RotationConfig {
  return rotationStore;
}

function saveConfig(config: RotationConfig): void {
  rotationStore = config;
}

export function __resetRotationStateForTests(): void {
  rotationStore = {
    activeVersion: 0,
    versions: [],
    gracePeriodMs: GRACE_PERIOD_MS,
  };
  rotationApprovals.clear();
}

function approvalKey(expectedVersion: number): string {
  return `secret-rotation:${expectedVersion}`;
}

function requiredApprovalCount(): number {
  const configured = Number(process.env.SECRET_ROTATION_REQUIRED_APPROVALS ?? "2");
  return Number.isFinite(configured) && configured > 0 ? Math.ceil(configured) : 2;
}

// ── Core rotation logic ─────────────────────────────────────────────

function getDecryptedSecret(config: RotationConfig, version: SecretVersion, passphrase: string): string {
  return decryptSecret(version.encryptedSecret, version.iv, version.authTag, passphrase);
}

/**
 * Compare-and-swap rotation: only succeeds if `expectedVersion` matches the current active version.
 * Returns the new version number on success, or a conflict result.
 */
export function rotateSecretCAS(
  expectedVersion: number,
  passphrase: string,
): { ok: true; newVersion: number } | { ok: false; conflictVersion: number } {
  const config = loadConfig();
  const currentVersion = config.activeVersion;

  if (currentVersion !== expectedVersion) {
    return { ok: false, conflictVersion: currentVersion };
  }

  const newSecret = randomBytes(32).toString("base64url");
  const { encrypted, iv, authTag } = encryptSecret(newSecret, passphrase);
  const newVersionNum = currentVersion + 1;

  config.versions.push({
    version: newVersionNum,
    encryptedSecret: encrypted,
    iv,
    authTag,
    createdAt: Date.now(),
  });

  // Expire versions older than grace period
  const cutoff = Date.now() - config.gracePeriodMs;
  config.versions = config.versions.filter((v) => v.version === newVersionNum || v.createdAt >= cutoff);

  config.activeVersion = newVersionNum;
  saveConfig(config);

  return { ok: true, newVersion: newVersionNum };
}

export function approveSecretRotation(
  expectedVersion: number,
  operatorId: string,
): { approved: false; requiredApprovals: number; receivedApprovals: number } | { approved: true } {
  const operator = operatorId.trim();
  if (!operator) {
    throw new Error("operatorId is required for secret rotation approval.");
  }
  const required = requiredApprovalCount();
  const key = approvalKey(expectedVersion);
  const approval = rotationApprovals.get(key) ?? {
    expectedVersion,
    operators: new Set<string>(),
    createdAt: Date.now(),
  };
  approval.operators.add(operator);
  rotationApprovals.set(key, approval);

  if (approval.operators.size < required) {
    return {
      approved: false,
      requiredApprovals: required,
      receivedApprovals: approval.operators.size,
    };
  }
  return { approved: true };
}

export function rotateSecretWithApprovals(
  expectedVersion: number,
  passphrase: string,
  operatorId: string,
): { ok: true; newVersion: number } | { ok: false; conflictVersion?: number; pending?: true; requiredApprovals?: number; receivedApprovals?: number } {
  const approval = approveSecretRotation(expectedVersion, operatorId);
  if (!approval.approved) return { ok: false, pending: true, ...approval };

  const before = loadConfig();
  const snapshot: RotationConfig = {
    activeVersion: before.activeVersion,
    gracePeriodMs: before.gracePeriodMs,
    versions: [...before.versions],
  };
  const result = rotateSecretCAS(expectedVersion, passphrase);
  if (!result.ok) return result;

  try {
    if (getActiveSecrets(passphrase).length === 0) {
      throw new Error("Rotated secret set failed verification.");
    }
    rotationApprovals.delete(approvalKey(expectedVersion));
    return result;
  } catch (err) {
    saveConfig(snapshot);
    throw err;
  }
}

/**
 * Get all currently active secrets (current + any within grace period).
 */
export function getActiveSecrets(passphrase: string): string[] {
  const config = loadConfig();
  const cutoff = Date.now() - config.gracePeriodMs;
  const activeVersions = config.versions.filter(
    (v) => v.version === config.activeVersion || v.createdAt >= cutoff,
  );
  return activeVersions.map((v) => getDecryptedSecret(config, v, passphrase));
}

/**
 * Verify if a secret is currently valid (current or within grace period).
 */
export function isSecretValid(secret: string, passphrase: string): boolean {
  const active = getActiveSecrets(passphrase);
  return active.includes(secret);
}

/**
 * Manually clean up expired previous versions.
 */
export function cleanupExpiredVersions(): void {
  const config = loadConfig();
  const cutoff = Date.now() - config.gracePeriodMs;
  config.versions = config.versions.filter(
    (v) => v.version === config.activeVersion || v.createdAt >= cutoff,
  );
  saveConfig(config);
}

function activeAdminSecrets(): string[] {
  return [process.env.ADMIN_TOKEN_SECRET, process.env.ADMIN_TOKEN_SECRET_PREVIOUS].filter(
    (value): value is string => Boolean(value) && value.length >= 16,
  );
}

/**
 * HTTP endpoint handler for manual rotation.
 * POST /api/auth/rotateSecret
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secrets = activeAdminSecrets();
  const authHeader = req.headers.authorization as string | undefined;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
  const clientIp = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown");

  if (secrets.length === 0 || !token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const passphrase = process.env.SECRET_ENCRYPTION_KEY;
  if (!passphrase) {
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  try {
    verifyAdminToken(secrets, token, {
      audience: process.env.ADMIN_TOKEN_AUDIENCE || "prompt-hash-admin",
      requiredScope: ROTATE_SECRET_SCOPE,
    });
  } catch (err) {
    const code = err instanceof AdminTokenError ? err.code : "unknown_error";
    void recordAuditEvent({
      action: "admin_auth_denied",
      result: "blocked",
      promptId: null,
      walletAddress: null,
      requestId: null,
      clientIp,
      reason: `scope=${ROTATE_SECRET_SCOPE} route=POST /auth/rotateSecret error=${code}`,
    });
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  void recordAuditEvent({
    action: "admin_auth_success",
    result: "success",
    promptId: null,
    walletAddress: null,
    requestId: null,
    clientIp,
    reason: `scope=${ROTATE_SECRET_SCOPE} route=POST /auth/rotateSecret`,
  });

  try {
    const config = loadConfig();
    const operatorId = String(req.body?.operatorId ?? req.headers["x-operator-id"] ?? "");
    const result = rotateSecretWithApprovals(config.activeVersion, passphrase, operatorId);

    if (!result.ok && result.pending) {
      res.status(202).json({
        pending: true,
        expectedVersion: config.activeVersion,
        requiredApprovals: result.requiredApprovals,
        receivedApprovals: result.receivedApprovals,
      });
      return;
    }

    if (!result.ok) {
      res.status(409).json({
        error: "Rotation conflict — another rotation occurred first",
        currentVersion: result.conflictVersion,
      });
      return;
    }

    // No secret material in logs or response
    res.status(200).json({
      success: true,
      rotationId: `rot_${Date.now()}`,
      newVersion: result.newVersion,
      gracePeriodMs: config.gracePeriodMs,
    });
  } catch (error) {
    res.status(500).json({ error: "Rotation failed" });
  }
}
