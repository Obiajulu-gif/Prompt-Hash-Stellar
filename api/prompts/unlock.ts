import {
  buildChallengeMessage,
  verifyChallengeSignature,
  verifyChallengeTokenWithSecrets,
  parseChallengeSecrets,
} from "../../src/lib/auth/challenge";
import {
  decryptPromptCiphertext,
  decodeWrappedPromptKey,
  hashPromptPlaintext,
  unwrapPromptKey,
} from "../../src/lib/crypto/promptCrypto";
import {
  getPrompt,
  hasAccess,
  type PromptHashConfig,
} from "../../src/lib/stellar/promptHashClient";
import { withObservability } from "../../src/lib/observability/wrapper";
import { checkRateLimit } from "../../src/lib/observability/rateLimiter";
import { metrics } from "../../src/lib/observability/metrics";

type UnlockKeyEntry = {
  version: string;
  publicKey: string;
  privateKey: string;
};

function parseVersionedKeyStore(raw?: string) {
  const entries = new Map<string, string>();
  if (!raw) {
    return entries;
  }

  for (const item of raw.split(",").map((entry) => entry.trim())) {
    if (!item) {
      continue;
    }

    const [version, value] = item.split(/:(.+)/);
    if (!version || !value) {
      throw new Error(
        "Malformed versioned unlock key entry. Expected version:keyBase64 format.",
      );
    }

    if (entries.has(version)) {
      throw new Error(`Duplicate unlocking key version configured: ${version}`);
    }

    entries.set(version, value);
  }

  return entries;
}

function loadUnlockKeyStore(
  currentVersion: string,
  publicKey?: string,
  privateKey?: string,
  publicKeyStore?: string,
  privateKeyStore?: string,
) {
  const publicKeys = parseVersionedKeyStore(publicKeyStore);
  const privateKeys = parseVersionedKeyStore(privateKeyStore);

  if (publicKeys.size === 0 && publicKey) {
    publicKeys.set(currentVersion, publicKey);
  }

  if (privateKeys.size === 0 && privateKey) {
    privateKeys.set(currentVersion, privateKey);
  }

  if (publicKeys.size === 0 || privateKeys.size === 0) {
    throw new Error(
      "Unlock key store is not configured. Set UNLOCK_PRIVATE_KEYS and UNLOCK_PUBLIC_KEYS or UNLOCK_PRIVATE_KEY/UNLOCK_PUBLIC_KEY.",
    );
  }

  const keySet = new Map<string, UnlockKeyEntry>();
  const versions = new Set<string>([
    ...Array.from(publicKeys.keys()),
    ...Array.from(privateKeys.keys()),
  ]);

  for (const version of versions) {
    const publicKeyValue = publicKeys.get(version);
    const privateKeyValue = privateKeys.get(version);

    if (!publicKeyValue || !privateKeyValue) {
      throw new Error(
        `Unlock key version ${version} does not have both public and private values configured.`,
      );
    }

    keySet.set(version, {
      version,
      publicKey: publicKeyValue,
      privateKey: privateKeyValue,
    });
  }

  return keySet;
}

function getServerConfig(): PromptHashConfig {
  const rpcUrl =
    process.env.PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
    "Test SDF Network ; September 2015";
  const promptHashContractId = process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID ?? "";
  const nativeAssetContractId =
    process.env.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID ??
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const simulationAccount =
    process.env.PUBLIC_STELLAR_SIMULATION_ACCOUNT ?? process.env.UNLOCK_PUBLIC_KEY ?? "";

  return {
    rpcUrl,
    networkPassphrase,
    promptHashContractId,
    nativeAssetContractId,
    simulationAccount,
    allowHttp: new URL(rpcUrl).hostname === "localhost",
  };
}

async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const clientIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress) as string;
  const { token, promptId, address, signedMessage } = req.body ?? {};

  // Rate limit by IP
  const ipRateLimit = checkRateLimit("unlock", clientIp);
  if (!ipRateLimit.success) {
    req.logger.warn({ clientIp }, "Rate limit exceeded for unlock (IP)");
    metrics.trackRateLimitHit("unlock_ip", clientIp);
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }

  // Rate limit by wallet if provided
  if (address) {
    const walletRateLimit = checkRateLimit("unlock", String(address));
    if (!walletRateLimit.success) {
      req.logger.warn({ address }, "Rate limit exceeded for unlock (Wallet)");
      metrics.trackRateLimitHit("unlock_wallet", String(address));
      res.status(429).json({ error: "Too many unlock attempts for this wallet." });
      return;
    }
  }

  const challengeSecret = process.env.CHALLENGE_TOKEN_SECRET;
  const challengeSecretHistory = process.env.CHALLENGE_TOKEN_PREVIOUS_SECRETS;
  const unlockKeyVersion = process.env.UNLOCK_KEY_VERSION ?? "v1";
  const unlockPublicKey = process.env.UNLOCK_PUBLIC_KEY;
  const unlockPrivateKey = process.env.UNLOCK_PRIVATE_KEY;
  const unlockPrivateKeys = process.env.UNLOCK_PRIVATE_KEYS;
  const unlockPublicKeys = process.env.UNLOCK_PUBLIC_KEYS;

  if (!challengeSecret) {
    req.logger.error("Unlock service is missing CHALLENGE_TOKEN_SECRET.");
    res.status(500).json({ error: "Configuration error." });
    return;
  }

  if (!unlockPublicKey && !unlockPublicKeys) {
    req.logger.error("Unlock service is missing public unlock key configuration.");
    res.status(500).json({ error: "Configuration error." });
    return;
  }

  if (!unlockPrivateKey && !unlockPrivateKeys) {
    req.logger.error("Unlock service is missing private unlock key configuration.");
    res.status(500).json({ error: "Configuration error." });
    return;
  }

  if (!token || !promptId || !address || !signedMessage) {
    res.status(400).json({
      error: "token, promptId, address, and signedMessage are required.",
    });
    return;
  }

  try {
    const challengeSecrets = parseChallengeSecrets(
      challengeSecret,
      challengeSecretHistory,
    );
    const payload = verifyChallengeTokenWithSecrets(
      challengeSecrets,
      String(token),
      String(address),
      String(promptId),
    );
    const challengeMessage = buildChallengeMessage(payload);
    const validSignature = verifyChallengeSignature(
      String(address),
      challengeMessage,
      String(signedMessage),
    );

    if (!validSignature) {
      req.logger.warn({ address, promptId }, "Invalid wallet signature");
      metrics.trackUnlockFailure(String(address), String(promptId), "invalid_signature");
      res.status(401).json({ error: "Invalid wallet signature." });
      return;
    }

    const config = getServerConfig();
    const id = BigInt(promptId);
    const access = await hasAccess(config, String(address), id);
    if (!access) {
      req.logger.warn({ address, promptId }, "Prompt access denied");
      metrics.trackUnlockFailure(String(address), String(promptId), "no_access");
      res.status(403).json({ error: "Prompt access has not been purchased." });
      return;
    }

    const prompt = await getPrompt(config, id);
    const wrappedKey = decodeWrappedPromptKey(prompt.wrappedKey);
    const keySet = loadUnlockKeyStore(
      unlockKeyVersion,
      unlockPublicKey,
      unlockPrivateKey,
      unlockPublicKeys,
      unlockPrivateKeys,
    );
    const keyPair = keySet.get(wrappedKey.version);

    if (!keyPair) {
      req.logger.error(
        { promptId, keyVersion: wrappedKey.version },
        "Unlock key version is not supported.",
      );
      metrics.trackUnlockFailure(
        String(address),
        String(promptId),
        "unsupported_key_version",
      );
      res.status(500).json({
        error: "Unlock key version is not configured for this prompt.",
      });
      return;
    }

    const keyBytes = await unwrapPromptKey(
      wrappedKey.wrappedKey,
      keyPair.publicKey,
      keyPair.privateKey,
    );
    const plaintext = await decryptPromptCiphertext(
      prompt.encryptedPrompt,
      prompt.encryptionIv,
      keyBytes,
    );
    const contentHash = await hashPromptPlaintext(plaintext);
    if (contentHash !== prompt.contentHash) {
      req.logger.error({ address, promptId }, "Prompt integrity check failed");
      metrics.trackUnlockFailure(String(address), String(promptId), "integrity_failure");
      res.status(500).json({ error: "Prompt integrity check failed." });
      return;
    }

    metrics.trackUnlockSuccess(String(address), String(promptId));
    req.logger.info({ address, promptId }, "Prompt unlocked successfully");

    res.status(200).json({
      promptId: prompt.id.toString(),
      title: prompt.title,
      contentHash,
      plaintext,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to unlock prompt.";
    req.logger.error(
      { address, promptId, error: message },
      "Unlock attempt failed",
    );
    metrics.trackUnlockFailure(String(address), String(promptId), "error");
    res.status(400).json({ error: message });
  }
}

export default withObservability(handler, "prompts/unlock");
