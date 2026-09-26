/**
 * PromptHash Stellar environment & deployment manifest validation.
 * Eliminates silent testnet fallbacks and hard-coded defaults in production.
 */

import { createHash } from "crypto";

const PLACEHOLDER_PATTERNS = [
  /^replace-with/i,
  /^BASE64_/i,
  /^[CG]X{10,}/,
  /^your-/i,
  /^<.*>$/,
];

export function isPlaceholder(val: string | undefined): boolean {
  if (!val) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(val));
}

export interface ServerDeploymentManifest {
  network: string;
  networkPassphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  promptHashContractId: string;
  nativeAssetContractId: string;
  simulationAccount: string;
  unlockPublicKey: string;
  manifestHash: string;
}

let cachedManifest: ServerDeploymentManifest | null = null;

export function isProductionEnv(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  const vercelEnv = process.env.VERCEL_ENV;
  return nodeEnv === "production" || vercelEnv === "production";
}

/**
 * Validates the full server deployment manifest across network, contracts, RPC, assets, and simulation account.
 * Throws explicit errors when required configuration is missing or invalid.
 */
export function getServerDeploymentManifest(forceRefresh = false): ServerDeploymentManifest {
  if (cachedManifest && !forceRefresh) {
    return cachedManifest;
  }

  const isProd = isProductionEnv();
  const errors: string[] = [];

  const network = process.env.PUBLIC_STELLAR_NETWORK || (isProd ? "" : "TESTNET");
  const defaultPassphrase = "Test SDF Network ; September 2015";
  const networkPassphrase =
    process.env.PUBLIC_STELLAR_NETWORK_PASSPHRASE ||
    (isProd ? "" : defaultPassphrase);

  const rpcUrl =
    process.env.PUBLIC_STELLAR_RPC_URL ||
    (isProd ? "" : "https://soroban-testnet.stellar.org");

  const horizonUrl =
    process.env.PUBLIC_STELLAR_HORIZON_URL ||
    (isProd ? "" : "https://horizon-testnet.stellar.org");

  const promptHashContractId = process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID || "";
  const nativeAssetContractId = process.env.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID || "";
  const simulationAccount = process.env.PUBLIC_STELLAR_SIMULATION_ACCOUNT || "";
  const unlockPublicKey = process.env.UNLOCK_PUBLIC_KEY || "";

  // 1. Production Mode Strict Checks
  if (isProd) {
    if (!process.env.PUBLIC_STELLAR_NETWORK) {
      errors.push("PUBLIC_STELLAR_NETWORK must be explicitly set in production mode.");
    }
    if (!process.env.PUBLIC_STELLAR_RPC_URL) {
      errors.push("PUBLIC_STELLAR_RPC_URL must be explicitly set in production mode.");
    }
    if (!process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID) {
      errors.push("PUBLIC_PROMPT_HASH_CONTRACT_ID must be explicitly set in production mode.");
    }
    if (!process.env.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID) {
      errors.push("PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID must be explicitly set in production mode.");
    }
    if (!process.env.PUBLIC_STELLAR_SIMULATION_ACCOUNT) {
      errors.push("PUBLIC_STELLAR_SIMULATION_ACCOUNT must be explicitly set in production mode (cannot fallback to UNLOCK_PUBLIC_KEY).");
    }
  }

  // 2. Format & Placeholder Checks
  if (isPlaceholder(network)) errors.push("PUBLIC_STELLAR_NETWORK has a placeholder value.");
  if (!rpcUrl || isPlaceholder(rpcUrl)) errors.push("PUBLIC_STELLAR_RPC_URL is missing or has a placeholder value.");
  if (promptHashContractId && isPlaceholder(promptHashContractId)) {
    errors.push("PUBLIC_PROMPT_HASH_CONTRACT_ID has a placeholder value.");
  }

  const STELLAR_CONTRACT_ID = /^C[A-Z0-9]{55}$/;
  const STELLAR_ACCOUNT_ID = /^G[A-Z0-9]{55}$/;

  if (promptHashContractId && !STELLAR_CONTRACT_ID.test(promptHashContractId) && isProd) {
    errors.push("PUBLIC_PROMPT_HASH_CONTRACT_ID must be a valid 56-character Soroban contract address starting with C.");
  }

  if (simulationAccount && !STELLAR_ACCOUNT_ID.test(simulationAccount) && isProd) {
    errors.push("PUBLIC_STELLAR_SIMULATION_ACCOUNT must be a valid 56-character Stellar public key starting with G.");
  }

  // Reject simulation account equal to unlock public key in production
  if (isProd && simulationAccount && unlockPublicKey && simulationAccount === unlockPublicKey) {
    errors.push("PUBLIC_STELLAR_SIMULATION_ACCOUNT cannot be identical to UNLOCK_PUBLIC_KEY in production.");
  }

  if (errors.length > 0) {
    throw new Error(`[Server Deployment Manifest Validation Failure]:\n- ${errors.join("\n- ")}`);
  }

  // Generate deterministic non-sensitive manifest identity hash
  const rawIdentity = [
    network,
    networkPassphrase,
    rpcUrl,
    promptHashContractId,
    nativeAssetContractId,
    simulationAccount,
    unlockPublicKey,
  ].join("|");

  const manifestHash = createHash("sha256").update(rawIdentity).digest("hex").slice(0, 16);

  cachedManifest = {
    network,
    networkPassphrase,
    rpcUrl,
    horizonUrl,
    promptHashContractId,
    nativeAssetContractId,
    simulationAccount,
    unlockPublicKey,
    manifestHash,
  };

  return cachedManifest;
}

export function getReadinessAttestation() {
  try {
    const manifest = getServerDeploymentManifest(true);
    return {
      ready: true,
      network: manifest.network,
      manifestHash: manifest.manifestHash,
      promptHashContractId: manifest.promptHashContractId,
      nativeAssetContractId: manifest.nativeAssetContractId,
      simulationAccount: manifest.simulationAccount,
      timestamp: Date.now(),
    };
  } catch (err: any) {
    return {
      ready: false,
      error: err.message,
      timestamp: Date.now(),
    };
  }
}

/**
 * Validates core cryptographic and signing keys required by the unlock service.
 */
export function validateUnlockSecrets() {
  const challengeSecret = process.env.CHALLENGE_TOKEN_SECRET;
  const unlockPublicKey = process.env.UNLOCK_PUBLIC_KEY;
  const unlockPrivateKey = process.env.UNLOCK_PRIVATE_KEY;

  const errors: string[] = [];

  if (!challengeSecret) {
    errors.push("CHALLENGE_TOKEN_SECRET is not configured.");
  } else if (isPlaceholder(challengeSecret)) {
    errors.push("CHALLENGE_TOKEN_SECRET still has a placeholder value.");
  } else if (challengeSecret.length < 16) {
    errors.push("CHALLENGE_TOKEN_SECRET must be at least 16 characters long.");
  }

  const BASE64_KEY = /^[A-Za-z0-9+/=]{20,}$/;

  if (!unlockPublicKey) {
    errors.push("UNLOCK_PUBLIC_KEY is not configured.");
  } else if (isPlaceholder(unlockPublicKey)) {
    errors.push("UNLOCK_PUBLIC_KEY still has a placeholder value.");
  } else if (!BASE64_KEY.test(unlockPublicKey)) {
    errors.push("UNLOCK_PUBLIC_KEY does not match base64 format.");
  }

  if (!unlockPrivateKey) {
    errors.push("UNLOCK_PRIVATE_KEY is not configured.");
  } else if (isPlaceholder(unlockPrivateKey)) {
    errors.push("UNLOCK_PRIVATE_KEY still has a placeholder value.");
  } else if (!BASE64_KEY.test(unlockPrivateKey)) {
    errors.push("UNLOCK_PRIVATE_KEY does not match base64 format.");
  }

  if (errors.length > 0) {
    throw new Error(`[Unlock Service Config Error]:\n- ${errors.join("\n- ")}`);
  }
}
