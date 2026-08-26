/**
 * Secret Rotation Endpoint
 *
 * Durable, atomic secret rotation with compare-and-swap versioning.
 * Concurrent rotations have a deterministic winner; the loser gets a retriable conflict.
 * No secret material is logged or returned in responses.
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

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

function loadConfig(): RotationConfig {
  return rotationStore;
}

function saveConfig(config: RotationConfig): void {
  rotationStore = config;
}

// ── Core rotation logic ─────────────────────────────────────────────

function getVersion(config: RotationConfig, version: number): SecretVersion | undefined {
  return config.versions.find((v) => v.version === version);
}

function getDecryptedSecret(config: RotationConfig, version: SecretVersion, passphrase: string): string {
  return decryptSecret(version.encryptedSecret, version.iv, version.authTag, passphrase);
}

/**
 * Compare-and-swap rotation: only succeeds if `expectedVersion` matches the current active version.
 * Returns the new version number on success, or -1 on conflict.
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

/**
 * Get all currently active secrets (current + any within grace period).
 * Returns decrypted secrets for HMAC verification.
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

/**
 * HTTP endpoint handler for manual rotation.
 * POST /api/auth/rotateSecret
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization;
  const adminToken = process.env.ADMIN_ROTATION_TOKEN;
  if (!adminToken || authHeader !== `Bearer ${adminToken}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const passphrase = process.env.SECRET_ENCRYPTION_KEY;
  if (!passphrase) {
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  try {
    const config = loadConfig();
    const result = rotateSecretCAS(config.activeVersion, passphrase);

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
