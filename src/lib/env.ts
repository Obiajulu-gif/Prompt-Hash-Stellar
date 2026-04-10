import { WalletNetwork } from "@creit.tech/stellar-wallets-kit";
import { z } from "zod";

const envSchema = z.object({
  PUBLIC_STELLAR_NETWORK: z.enum([
    "PUBLIC",
    "FUTURENET",
    "TESTNET",
    "LOCAL",
    "STANDALONE",
  ] as const),
  PUBLIC_STELLAR_NETWORK_PASSPHRASE: z.nativeEnum(WalletNetwork),
  PUBLIC_STELLAR_RPC_URL: z.string().url().or(z.string().startsWith("http://")),
  PUBLIC_STELLAR_HORIZON_URL: z
    .string()
    .url()
    .or(z.string().startsWith("http://")),
  PUBLIC_PROMPT_HASH_CONTRACT_ID: z.string(),
  PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID: z.string(),
  PUBLIC_STELLAR_SIMULATION_ACCOUNT: z.string(),
  PUBLIC_CHAT_API_BASE: z.string().url(),
  PUBLIC_UNLOCK_PUBLIC_KEY: z.string(),
});

const fallback = {
  PUBLIC_STELLAR_NETWORK: "TESTNET" as const,
  PUBLIC_STELLAR_NETWORK_PASSPHRASE: WalletNetwork.TESTNET,
  PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
  PUBLIC_PROMPT_HASH_CONTRACT_ID: "",
  PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID:
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  PUBLIC_STELLAR_SIMULATION_ACCOUNT: "",
  PUBLIC_CHAT_API_BASE: "https://secret-ai-gateway.onrender.com",
  PUBLIC_UNLOCK_PUBLIC_KEY: "",
};

const env = envSchema.parse({
  PUBLIC_STELLAR_NETWORK:
    import.meta.env.PUBLIC_STELLAR_NETWORK ?? fallback.PUBLIC_STELLAR_NETWORK,
  PUBLIC_STELLAR_NETWORK_PASSPHRASE:
    import.meta.env.PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
    fallback.PUBLIC_STELLAR_NETWORK_PASSPHRASE,
  PUBLIC_STELLAR_RPC_URL:
    import.meta.env.PUBLIC_STELLAR_RPC_URL ?? fallback.PUBLIC_STELLAR_RPC_URL,
  PUBLIC_STELLAR_HORIZON_URL:
    import.meta.env.PUBLIC_STELLAR_HORIZON_URL ??
    fallback.PUBLIC_STELLAR_HORIZON_URL,
  PUBLIC_PROMPT_HASH_CONTRACT_ID:
    import.meta.env.PUBLIC_PROMPT_HASH_CONTRACT_ID ??
    fallback.PUBLIC_PROMPT_HASH_CONTRACT_ID,
  PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID:
    import.meta.env.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID ??
    fallback.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID,
  PUBLIC_STELLAR_SIMULATION_ACCOUNT:
    import.meta.env.PUBLIC_STELLAR_SIMULATION_ACCOUNT ??
    fallback.PUBLIC_STELLAR_SIMULATION_ACCOUNT,
  PUBLIC_CHAT_API_BASE:
    import.meta.env.PUBLIC_CHAT_API_BASE ?? fallback.PUBLIC_CHAT_API_BASE,
  PUBLIC_UNLOCK_PUBLIC_KEY:
    import.meta.env.PUBLIC_UNLOCK_PUBLIC_KEY ?? fallback.PUBLIC_UNLOCK_PUBLIC_KEY,
});

export const stellarNetwork =
  env.PUBLIC_STELLAR_NETWORK === "STANDALONE"
    ? "LOCAL"
    : env.PUBLIC_STELLAR_NETWORK;
export const networkPassphrase = env.PUBLIC_STELLAR_NETWORK_PASSPHRASE;
export const rpcUrl = env.PUBLIC_STELLAR_RPC_URL;
export const horizonUrl = env.PUBLIC_STELLAR_HORIZON_URL;
export const promptHashContractId = env.PUBLIC_PROMPT_HASH_CONTRACT_ID;
export const nativeAssetContractId = env.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID;
export const simulationAccount = env.PUBLIC_STELLAR_SIMULATION_ACCOUNT;
export const chatApiBase = env.PUBLIC_CHAT_API_BASE;
export const unlockPublicKey = env.PUBLIC_UNLOCK_PUBLIC_KEY;
export const allowHttp = new URL(rpcUrl).hostname === "localhost";

export const stellarWalletNetwork =
  networkPassphrase === WalletNetwork.STANDALONE
    ? WalletNetwork.STANDALONE
    : networkPassphrase;
