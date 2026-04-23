import { z } from "zod";
import {
  buildChallengeMessage,
  verifyChallengeSignature,
  verifyChallengeToken,
} from "../../src/lib/auth/challenge";
import {
  decryptPromptCiphertext,
  hashPromptPlaintext,
  unwrapPromptKey,
} from "../../src/lib/crypto/promptCrypto";
import {
  getPrompt,
  hasAccess,
  type PromptHashConfig,
} from "../../src/lib/stellar/promptHashClient";

const UnlockRequestSchema = z.object({
  token: z.string().min(1, "token is required"),
  promptId: z.string().min(1, "promptId is required"),
  address: z.string().min(1, "address is required"),
  signedMessage: z.string().min(1, "signedMessage is required"),
});

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
    return res.status(405).json({ error: "Method not allowed." });
  }

  const challengeSecret = process.env.CHALLENGE_TOKEN_SECRET;
  const unlockPublicKey = process.env.UNLOCK_PUBLIC_KEY;
  const unlockPrivateKey = process.env.UNLOCK_PRIVATE_KEY;

  if (!challengeSecret || !unlockPublicKey || !unlockPrivateKey) {
    console.error("Unlock service configuration missing required secrets.");
    return res.status(500).json({ error: "Server configuration error." });
  }

  try {
    const { token, promptId, address, signedMessage } = UnlockRequestSchema.parse(req.body);

    let payload;
    try {
      payload = verifyChallengeToken(
        challengeSecret,
        token,
        address,
        promptId,
      );
    } catch (e: any) {
      const msg = e.message || "Invalid or expired challenge token.";
      return res.status(401).json({ error: msg, code: "INVALID_TOKEN" });
    }

    const challengeMessage = buildChallengeMessage(payload);
    const validSignature = verifyChallengeSignature(
      address,
      challengeMessage,
      signedMessage,
    );

    if (!validSignature) {
      return res.status(401).json({ error: "Invalid wallet signature.", code: "INVALID_SIGNATURE" });
    }

    const config = getServerConfig();
    const id = BigInt(promptId);
    
    // Check access on-chain
    const access = await hasAccess(config, address, id);
    if (!access) {
      return res.status(403).json({ 
        error: "Prompt access has not been purchased.", 
        code: "ACCESS_DENIED" 
      });
    }

    const prompt = await getPrompt(config, id);
    
    let plaintext;
    try {
      const keyBytes = await unwrapPromptKey(
        prompt.wrappedKey,
        unlockPublicKey,
        unlockPrivateKey,
      );
      plaintext = await decryptPromptCiphertext(
        prompt.encryptedPrompt,
        prompt.encryptionIv,
        keyBytes,
      );
    } catch (e) {
      console.error("Decryption failure:", e);
      return res.status(500).json({ error: "Failed to decrypt prompt.", code: "DECRYPTION_ERROR" });
    }

    const contentHash = await hashPromptPlaintext(plaintext);
    if (contentHash !== prompt.contentHash) {
      return res.status(500).json({ 
        error: "Prompt integrity check failed.", 
        code: "INTEGRITY_ERROR" 
      });
    }

    return res.status(200).json({
      promptId: prompt.id.toString(),
      title: prompt.title,
      contentHash,
      plaintext,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || error.message, code: "BAD_REQUEST" });
    }
    console.error("Unlock handler error:", error);
    return res.status(500).json({ error: "Internal server error.", code: "INTERNAL_ERROR" });
  }
}
