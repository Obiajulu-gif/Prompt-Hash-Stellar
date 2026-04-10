import {
  buildChallengeMessage,
  verifyChallengeSignature,
  verifyChallengeToken,
} from "../../../src/lib/auth/challenge";
import {
  decryptPromptCiphertext,
  hashPromptPlaintext,
  unwrapPromptKey,
} from "../../../src/lib/crypto/promptCrypto";
import {
  getPrompt,
  hasAccess,
  type PromptHashConfig,
} from "../../../src/lib/stellar/promptHashClient";

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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const challengeSecret = process.env.CHALLENGE_TOKEN_SECRET;
  const unlockPublicKey = process.env.UNLOCK_PUBLIC_KEY;
  const unlockPrivateKey = process.env.UNLOCK_PRIVATE_KEY;
  if (!challengeSecret || !unlockPublicKey || !unlockPrivateKey) {
    res.status(500).json({
      error:
        "Unlock service is missing CHALLENGE_TOKEN_SECRET, UNLOCK_PUBLIC_KEY, or UNLOCK_PRIVATE_KEY.",
    });
    return;
  }

  const { token, promptId, address, signedMessage } = req.body ?? {};
  if (!token || !promptId || !address || !signedMessage) {
    res.status(400).json({
      error: "token, promptId, address, and signedMessage are required.",
    });
    return;
  }

  try {
    const payload = verifyChallengeToken(
      challengeSecret,
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
      res.status(401).json({ error: "Invalid wallet signature." });
      return;
    }

    const config = getServerConfig();
    const id = BigInt(promptId);
    const access = await hasAccess(config, String(address), id);
    if (!access) {
      res.status(403).json({ error: "Prompt access has not been purchased." });
      return;
    }

    const prompt = await getPrompt(config, id);
    const keyBytes = await unwrapPromptKey(
      prompt.wrappedKey,
      unlockPublicKey,
      unlockPrivateKey,
    );
    const plaintext = await decryptPromptCiphertext(
      prompt.encryptedPrompt,
      prompt.encryptionIv,
      keyBytes,
    );
    const contentHash = await hashPromptPlaintext(plaintext);
    if (contentHash !== prompt.contentHash) {
      res.status(500).json({ error: "Prompt integrity check failed." });
      return;
    }

    res.status(200).json({
      promptId: prompt.id.toString(),
      title: prompt.title,
      contentHash,
      plaintext,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to unlock prompt.";
    res.status(400).json({ error: message });
  }
}
