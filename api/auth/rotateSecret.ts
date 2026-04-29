/**
 * Secret Rotation Endpoint
 * 
 * This endpoint handles the rotation of challenge token secrets.
 * It supports multiple active secrets during a grace period to prevent
 * service disruption during rotation.
 */

import { randomBytes } from "crypto";

interface SecretRotationConfig {
  currentSecret: string;
  previousSecret?: string;
  rotationTimestamp: number;
  gracePeriodMs: number;
}

const DEFAULT_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a new cryptographically secure secret
 */
export function generateNewSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Get active secrets (current + previous if within grace period)
 */
export function getActiveSecrets(): string[] {
  const config = getRotationConfig();
  const secrets = [config.currentSecret];
  
  if (config.previousSecret) {
    const timeSinceRotation = Date.now() - config.rotationTimestamp;
    if (timeSinceRotation < config.gracePeriodMs) {
      secrets.push(config.previousSecret);
    }
  }
  
  return secrets;
}

/**
 * Rotate the secret and update environment
 */
export function rotateSecret(): SecretRotationConfig {
  const currentSecret = process.env.CHALLENGE_TOKEN_SECRET;
  if (!currentSecret) {
    throw new Error("CHALLENGE_TOKEN_SECRET not configured");
  }

  const newSecret = generateNewSecret();
  const newConfig: SecretRotationConfig = {
    currentSecret: newSecret,
    previousSecret: currentSecret,
    rotationTimestamp: Date.now(),
    gracePeriodMs: DEFAULT_GRACE_PERIOD_MS,
  };

  // Store rotation config (in production, use secure storage like AWS Secrets Manager)
  storeRotationConfig(newConfig);

  return newConfig;
}

/**
 * Get current rotation configuration
 */
function getRotationConfig(): SecretRotationConfig {
  // In production, retrieve from secure storage
  // For now, use environment variables
  const currentSecret = process.env.CHALLENGE_TOKEN_SECRET || "";
  const previousSecret = process.env.CHALLENGE_TOKEN_SECRET_PREVIOUS;
  const rotationTimestamp = parseInt(
    process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP || "0",
    10
  );
  const gracePeriodMs = parseInt(
    process.env.CHALLENGE_TOKEN_GRACE_PERIOD_MS || String(DEFAULT_GRACE_PERIOD_MS),
    10
  );

  return {
    currentSecret,
    previousSecret,
    rotationTimestamp,
    gracePeriodMs,
  };
}

/**
 * Store rotation configuration
 * In production, this should write to AWS Secrets Manager, HashiCorp Vault, etc.
 */
function storeRotationConfig(config: SecretRotationConfig): void {
  // Mock implementation - in production, use secure secret storage
  console.log("⚠️ MOCK: Secret rotation config should be stored in secure storage");
  console.log("New secret generated:", config.currentSecret.substring(0, 8) + "...");
  console.log("Previous secret retained for grace period:", config.gracePeriodMs, "ms");
  
  // In production, update environment variables or secret manager:
  // await secretsManager.updateSecret({
  //   SecretId: 'challenge-token-secret',
  //   SecretString: JSON.stringify(config)
  // });
}

/**
 * Verify if a secret is currently valid (current or within grace period)
 */
export function isSecretValid(secret: string): boolean {
  const activeSecrets = getActiveSecrets();
  return activeSecrets.includes(secret);
}

/**
 * Clean up expired previous secrets
 */
export function cleanupExpiredSecrets(): void {
  const config = getRotationConfig();
  
  if (config.previousSecret) {
    const timeSinceRotation = Date.now() - config.rotationTimestamp;
    
    if (timeSinceRotation >= config.gracePeriodMs) {
      // Grace period expired, remove previous secret
      const cleanedConfig: SecretRotationConfig = {
        currentSecret: config.currentSecret,
        previousSecret: undefined,
        rotationTimestamp: config.rotationTimestamp,
        gracePeriodMs: config.gracePeriodMs,
      };
      
      storeRotationConfig(cleanedConfig);
      console.log("✓ Expired previous secret cleaned up");
    }
  }
}

// HTTP endpoint handler for manual rotation
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Authentication check - only allow authorized operators
  const authHeader = req.headers.authorization;
  const adminToken = process.env.ADMIN_ROTATION_TOKEN;
  
  if (!adminToken || authHeader !== `Bearer ${adminToken}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const newConfig = rotateSecret();
    
    res.status(200).json({
      success: true,
      message: "Secret rotated successfully",
      rotationTimestamp: newConfig.rotationTimestamp,
      gracePeriodMs: newConfig.gracePeriodMs,
      expiresAt: newConfig.rotationTimestamp + newConfig.gracePeriodMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rotation failed";
    res.status(500).json({ error: message });
  }
}
