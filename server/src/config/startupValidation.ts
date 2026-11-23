/**
 * Production-Grade Startup Configuration & Secret Validation (#1095).
 *
 * Fails early when runtime configuration is incomplete, unsafe, conflicting,
 * or pointed at the wrong Stellar network.
 *
 * Core Guarantees:
 *   1. Fail-Fast: Detects invalid/missing configuration before database connections,
 *      contract clients, or server listeners initialize.
 *   2. Secret Safety: NEVER prints secret values, raw tokens, or connection credentials
 *      in logs, error messages, or telemetry.
 *   3. Network & Passphrase Conflict Detection: Enforces strict alignment between
 *      PUBLIC_STELLAR_NETWORK, PUBLIC_STELLAR_NETWORK_PASSPHRASE, and RPC/Horizon endpoints.
 *   4. Placeholder Detection: Prevents default template strings from leaking into production.
 *
 * Complexity:
 *   - Time Complexity: O(K) where K is the number of evaluated environment keys (~15 keys).
 *   - Space Complexity: O(1) constant auxiliary space.
 */

export interface ConfigValidationError {
  key: string;
  code:
    | "MISSING_REQUIRED"
    | "PLACEHOLDER_VALUE"
    | "MALFORMED_FORMAT"
    | "NETWORK_CONFLICT"
    | "UNSAFE_PROTOCOL"
    | "INSUFFICIENT_ENTROPY";
  message: string;
  remediation: string;
}

export interface StartupValidationReport {
  valid: boolean;
  environment: string;
  network: string;
  checkedKeysCount: number;
  errors: ConfigValidationError[];
}

export interface StartupValidationOptions {
  /** If true, throws StartupConfigurationError on validation failure. Defaults to true. */
  throwOnError?: boolean;
  /** Force strict production checks even if NODE_ENV !== "production". */
  strictProduction?: boolean;
}

export class StartupConfigurationError extends Error {
  readonly errors: ConfigValidationError[];

  constructor(errors: ConfigValidationError[]) {
    const summary = errors
      .map((e) => `  - [${e.code}] ${e.key}: ${e.message} (Fix: ${e.remediation})`)
      .join("\n");
    super(`Startup configuration validation failed with ${errors.length} error(s):\n${summary}`);
    this.name = "StartupConfigurationError";
    this.errors = errors;
  }
}

// ── Known Canonical Network Definitions ─────────────────────────────────────

export const STELLAR_NETWORK_PASSPHRASES: Readonly<Record<string, string>> = Object.freeze({
  PUBLIC: "Public Global Stellar Network ; September 2015",
  TESTNET: "Test SDF Network ; September 2015",
  FUTURENET: "Test SDF Future Network ; October 2022",
  LOCAL: "Standalone Network ; February 2017",
  STANDALONE: "Standalone Network ; February 2017",
});

const VALID_ENVIRONMENTS = new Set(["production", "staging", "development", "test"]);
const VALID_NETWORKS = new Set(["PUBLIC", "TESTNET", "FUTURENET", "LOCAL", "STANDALONE"]);

const STELLAR_CONTRACT_ID_REGEX = /^C[A-Z0-9]{55}$/;
const STELLAR_ACCOUNT_ID_REGEX = /^G[A-Z0-9]{55}$/;
const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const KNOWN_PLACEHOLDER_PATTERNS = [
  /^replace[-_]?with/i,
  /^your[-_]/i,
  /^dummy[-_]/i,
  /^super-secret/i,
  /^placeholder/i,
  /_here$/i,
  /^<.*>$/,
  /^ZHVtbXktcHVibGljLWtleS12YWx1ZS1oZXJl$/, // base64 "dummy-public-key-value-here"
  /^ZHVtbXktcHJpdmF0ZS1rZXktdmFsdWUtaGVyZQ==$/, // base64 "dummy-private-key-value-here"
  /^ZHVtbXktcmVjZWlwdC/, // base64 "dummy-receipt-"
  /^C[A]{55}$/, // CAAAAA...
  /^G[A]{55}$/, // GAAAAA...
  /^C[X]{55}$/,
  /^G[X]{55}$/,
];

export function isPlaceholderValue(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  return KNOWN_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Validates runtime configuration and secrets against production requirements.
 */
export function validateStartupConfig(
  env: Record<string, string | undefined> = process.env,
  options: StartupValidationOptions = {},
): StartupValidationReport {
  const errors: ConfigValidationError[] = [];
  let checkedCount = 0;

  const nodeEnv = (env.NODE_ENV || "development").toLowerCase().trim();
  const isProduction = options.strictProduction || nodeEnv === "production";
  checkedCount++;

  // 1. Validate Environment Name
  if (!VALID_ENVIRONMENTS.has(nodeEnv)) {
    errors.push({
      key: "NODE_ENV",
      code: "MALFORMED_FORMAT",
      message: `Invalid environment name '${nodeEnv}'.`,
      remediation: "Set NODE_ENV to 'production', 'staging', 'development', or 'test'.",
    });
  }

  // 2. Validate Network Identifier
  const network = (env.PUBLIC_STELLAR_NETWORK || (isProduction ? "" : "TESTNET")).toUpperCase().trim();
  checkedCount++;

  if (!network) {
    errors.push({
      key: "PUBLIC_STELLAR_NETWORK",
      code: "MISSING_REQUIRED",
      message: "PUBLIC_STELLAR_NETWORK is not defined.",
      remediation: "Set PUBLIC_STELLAR_NETWORK to 'PUBLIC', 'TESTNET', or 'FUTURENET'.",
    });
  } else if (!VALID_NETWORKS.has(network)) {
    errors.push({
      key: "PUBLIC_STELLAR_NETWORK",
      code: "MALFORMED_FORMAT",
      message: `Unknown Stellar network '${network}'.`,
      remediation: "Allowed values: 'PUBLIC', 'TESTNET', 'FUTURENET', 'LOCAL', 'STANDALONE'.",
    });
  }

  // 3. Network Passphrase & Conflict Detection
  const passphrase = env.PUBLIC_STELLAR_NETWORK_PASSPHRASE?.trim();
  checkedCount++;

  if (!passphrase) {
    if (isProduction) {
      errors.push({
        key: "PUBLIC_STELLAR_NETWORK_PASSPHRASE",
        code: "MISSING_REQUIRED",
        message: "PUBLIC_STELLAR_NETWORK_PASSPHRASE must be set in production.",
        remediation: `Set to '${STELLAR_NETWORK_PASSPHRASES[network] || "appropriate network passphrase"}'.`,
      });
    }
  } else if (network && STELLAR_NETWORK_PASSPHRASES[network]) {
    const expectedPassphrase = STELLAR_NETWORK_PASSPHRASES[network];
    if (passphrase !== expectedPassphrase) {
      errors.push({
        key: "PUBLIC_STELLAR_NETWORK_PASSPHRASE",
        code: "NETWORK_CONFLICT",
        message: `Network passphrase mismatch. PUBLIC_STELLAR_NETWORK is '${network}' but passphrase does not match.`,
        remediation: `For network '${network}', set passphrase to '${expectedPassphrase}'.`,
      });
    }
  }

  // 4. RPC & Horizon URL Sanity and Network Alignment
  const rpcUrl = env.PUBLIC_STELLAR_RPC_URL?.trim();
  const horizonUrl = env.PUBLIC_STELLAR_HORIZON_URL?.trim();
  checkedCount += 2;

  const validateUrl = (key: string, url: string | undefined, requireHttps: boolean) => {
    if (!url) {
      if (isProduction) {
        errors.push({
          key,
          code: "MISSING_REQUIRED",
          message: `${key} is required.`,
          remediation: `Provide a valid endpoint URL for ${network} network.`,
        });
      }
      return;
    }

    try {
      const parsed = new URL(url);
      const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (requireHttps && !isLocalHost && parsed.protocol !== "https:") {
        errors.push({
          key,
          code: "UNSAFE_PROTOCOL",
          message: `${key} protocol must be 'https:' in production for non-localhost endpoints.`,
          remediation: "Update the endpoint URL to use HTTPS.",
        });
      }

      // Check for network cross-wiring conflicts
      if (network === "PUBLIC") {
        if (parsed.hostname.includes("testnet") || parsed.hostname.includes("futurenet")) {
          errors.push({
            key,
            code: "NETWORK_CONFLICT",
            message: `${key} points to a testnet/futurenet host ('${parsed.hostname}') while PUBLIC_STELLAR_NETWORK is 'PUBLIC'.`,
            remediation: "Point RPC and Horizon to production Mainnet endpoints.",
          });
        }
      } else if (network === "TESTNET") {
        if (parsed.hostname === "horizon.stellar.org" || parsed.hostname === "mainnet.sorobanrpc.com") {
          errors.push({
            key,
            code: "NETWORK_CONFLICT",
            message: `${key} points to Mainnet while PUBLIC_STELLAR_NETWORK is 'TESTNET'.`,
            remediation: "Point to Stellar Testnet RPC and Horizon endpoints.",
          });
        }
      }
    } catch {
      errors.push({
        key,
        code: "MALFORMED_FORMAT",
        message: `${key} is not a valid URL.`,
        remediation: "Ensure the value includes a valid protocol (e.g. https://).",
      });
    }
  };

  validateUrl("PUBLIC_STELLAR_RPC_URL", rpcUrl, isProduction);
  validateUrl("PUBLIC_STELLAR_HORIZON_URL", horizonUrl, isProduction);

  // 5. MongoDB URI Validation
  const mongoUri = env.MONGODB_URI?.trim();
  checkedCount++;

  if (!mongoUri) {
    if (isProduction) {
      errors.push({
        key: "MONGODB_URI",
        code: "MISSING_REQUIRED",
        message: "MONGODB_URI must be configured.",
        remediation: "Set MONGODB_URI to a valid MongoDB connection string.",
      });
    }
  } else {
    if (!mongoUri.startsWith("mongodb://") && !mongoUri.startsWith("mongodb+srv://")) {
      errors.push({
        key: "MONGODB_URI",
        code: "MALFORMED_FORMAT",
        message: "MONGODB_URI must start with 'mongodb://' or 'mongodb+srv://'.",
        remediation: "Provide a valid MongoDB connection URI format.",
      });
    }
    if (isProduction && (mongoUri.includes("127.0.0.1") || mongoUri.includes("localhost"))) {
      errors.push({
        key: "MONGODB_URI",
        code: "UNSAFE_PROTOCOL",
        message: "Production MONGODB_URI cannot point to localhost.",
        remediation: "Configure production clustered database credentials.",
      });
    }
  }

  // 6. Stellar Smart Contract and Simulation Account IDs
  const contractId = env.PUBLIC_PROMPT_HASH_CONTRACT_ID?.trim();
  const nativeAssetId = env.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID?.trim();
  const simAccount = env.PUBLIC_STELLAR_SIMULATION_ACCOUNT?.trim();
  checkedCount += 3;

  const validateContractId = (key: string, val: string | undefined) => {
    if (!val) {
      if (isProduction) {
        errors.push({
          key,
          code: "MISSING_REQUIRED",
          message: `${key} is missing.`,
          remediation: "Set a 56-character alphanumeric Stellar contract ID starting with 'C'.",
        });
      }
      return;
    }
    if (isPlaceholderValue(val)) {
      if (isProduction) {
        errors.push({
          key,
          code: "PLACEHOLDER_VALUE",
          message: `${key} contains a placeholder value.`,
          remediation: "Replace dummy contract address with deployed contract ID.",
        });
      }
      return;
    }
    if (!STELLAR_CONTRACT_ID_REGEX.test(val)) {
      errors.push({
        key,
        code: "MALFORMED_FORMAT",
        message: `${key} must be a 56-character string starting with 'C'.`,
        remediation: "Verify the contract ID matches Stellar StrKey format.",
      });
    }
  };

  validateContractId("PUBLIC_PROMPT_HASH_CONTRACT_ID", contractId);
  validateContractId("PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID", nativeAssetId);

  if (!simAccount) {
    if (isProduction) {
      errors.push({
        key: "PUBLIC_STELLAR_SIMULATION_ACCOUNT",
        code: "MISSING_REQUIRED",
        message: "PUBLIC_STELLAR_SIMULATION_ACCOUNT must be configured in production.",
        remediation: "Provide a dedicated 56-character Stellar public key starting with 'G'.",
      });
    }
  } else if (isPlaceholderValue(simAccount)) {
    if (isProduction) {
      errors.push({
        key: "PUBLIC_STELLAR_SIMULATION_ACCOUNT",
        code: "PLACEHOLDER_VALUE",
        message: "Simulation account contains a placeholder value.",
        remediation: "Configure a valid Stellar public key starting with 'G'.",
      });
    }
  } else if (!STELLAR_ACCOUNT_ID_REGEX.test(simAccount)) {
    errors.push({
      key: "PUBLIC_STELLAR_SIMULATION_ACCOUNT",
      code: "MALFORMED_FORMAT",
      message: "PUBLIC_STELLAR_SIMULATION_ACCOUNT must be a 56-character public key starting with 'G'.",
      remediation: "Verify account public key starts with 'G'.",
    });
  }

  // 7. Required Cryptographic Secrets & Token Validation
  const challengeSecret = env.CHALLENGE_TOKEN_SECRET?.trim();
  const unlockPubKey = (env.UNLOCK_PUBLIC_KEY || env.PUBLIC_UNLOCK_PUBLIC_KEY)?.trim();
  const unlockPrivKey = env.UNLOCK_PRIVATE_KEY?.trim();
  checkedCount += 3;

  if (isProduction && simAccount && unlockPubKey && simAccount === unlockPubKey) {
    errors.push({
      key: "PUBLIC_STELLAR_SIMULATION_ACCOUNT",
      code: "NETWORK_CONFLICT",
      message: "PUBLIC_STELLAR_SIMULATION_ACCOUNT cannot be identical to UNLOCK_PUBLIC_KEY in production.",
      remediation: "Use a dedicated read-only simulation account separate from the unlock keypair.",
    });
  }

  if (!challengeSecret) {
    if (isProduction) {
      errors.push({
        key: "CHALLENGE_TOKEN_SECRET",
        code: "MISSING_REQUIRED",
        message: "CHALLENGE_TOKEN_SECRET is not configured.",
        remediation: "Generate a secure secret with at least 32 characters.",
      });
    }
  } else {
    if (isPlaceholderValue(challengeSecret)) {
      if (isProduction) {
        errors.push({
          key: "CHALLENGE_TOKEN_SECRET",
          code: "PLACEHOLDER_VALUE",
          message: "CHALLENGE_TOKEN_SECRET contains an insecure default placeholder.",
          remediation: "Replace with high-entropy cryptographically secure secret.",
        });
      }
    } else if (challengeSecret.length < (isProduction ? 32 : 16)) {
      errors.push({
        key: "CHALLENGE_TOKEN_SECRET",
        code: "INSUFFICIENT_ENTROPY",
        message: `CHALLENGE_TOKEN_SECRET has insufficient length (${challengeSecret.length} chars).`,
        remediation: `Use at least ${isProduction ? 32 : 16} characters for secure token signing.`,
      });
    }
  }

  const validateBase64Key = (key: string, val: string | undefined, minLen = 20) => {
    if (!val) {
      if (isProduction) {
        errors.push({
          key,
          code: "MISSING_REQUIRED",
          message: `${key} must be provided.`,
          remediation: "Provide valid base64-encoded key.",
        });
      }
      return;
    }
    if (isPlaceholderValue(val)) {
      if (isProduction) {
        errors.push({
          key,
          code: "PLACEHOLDER_VALUE",
          message: `${key} contains dummy placeholder bytes.`,
          remediation: "Generate genuine cryptographic keypair.",
        });
      }
      return;
    }
    if (val.length < minLen || !BASE64_REGEX.test(val)) {
      errors.push({
        key,
        code: "MALFORMED_FORMAT",
        message: `${key} is not valid base64 or has insufficient byte length.`,
        remediation: "Ensure key is standard base64 encoded.",
      });
    }
  };

  validateBase64Key("UNLOCK_PUBLIC_KEY", unlockPubKey);
  validateBase64Key("UNLOCK_PRIVATE_KEY", unlockPrivKey);

  const report: StartupValidationReport = {
    valid: errors.length === 0,
    environment: nodeEnv,
    network,
    checkedKeysCount: checkedCount,
    errors,
  };

  if (!report.valid && options.throwOnError !== false) {
    throw new StartupConfigurationError(errors);
  }

  return report;
}
