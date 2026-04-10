import { Buffer } from "buffer";
import { approveNativeAssetSpend } from "./nativeAssetClient";
import {
  getRpcServer,
  readContract,
  readSimulationResult,
  scValArg,
  prepareContractCall,
  submitPreparedTransaction,
  type StellarNetworkConfig,
  type WalletTransactionSigner,
} from "./tx";

export interface PromptRecord {
  id: bigint;
  creator: string;
  imageUrl: string;
  title: string;
  category: string;
  previewText: string;
  encryptedPrompt: string;
  encryptionIv: string;
  wrappedKey: string;
  contentHash: string;
  priceStroops: bigint;
  active: boolean;
  salesCount: number;
}

export interface PromptHashConfig extends StellarNetworkConfig {
  promptHashContractId: string;
  nativeAssetContractId: string;
}

export interface CreatePromptInput {
  imageUrl: string;
  title: string;
  category: string;
  previewText: string;
  encryptedPrompt: string;
  encryptionIv: string;
  wrappedKey: string;
  contentHash: string;
  priceStroops: bigint;
}

function unwrapContractResult<T>(value: unknown): T {
  if (Array.isArray(value) && value.length === 2) {
    if (value[0] === "Ok") {
      return value[1] as T;
    }

    if (value[0] === "Err") {
      throw new Error(`Contract error: ${String(value[1])}`);
    }
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("Ok" in record) {
      return record.Ok as T;
    }

    if ("ok" in record) {
      return record.ok as T;
    }

    if ("Err" in record || "err" in record) {
      throw new Error(`Contract error: ${String(record.Err ?? record.err)}`);
    }
  }

  return value as T;
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error("Unexpected prompt payload returned from the contract.");
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(value);
  }

  if (typeof value === "string") {
    return BigInt(value);
  }

  throw new Error(`Expected bigint-compatible value, received ${String(value)}.`);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    return Number(value);
  }

  throw new Error(`Expected number-compatible value, received ${String(value)}.`);
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value === "true";
  }

  throw new Error(`Expected boolean-compatible value, received ${String(value)}.`);
}

function toHex(value: unknown) {
  if (typeof value === "string" && /^[0-9a-fA-F]+$/.test(value)) {
    return value.toLowerCase();
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return Buffer.from(value).toString("hex");
  }

  throw new Error("Unexpected bytes payload returned from the contract.");
}

function normalizePrompt(value: unknown): PromptRecord {
  const prompt = asRecord(value);
  return {
    id: toBigInt(prompt.id),
    creator: String(prompt.creator),
    imageUrl: String(prompt.image_url ?? prompt.imageUrl ?? ""),
    title: String(prompt.title ?? ""),
    category: String(prompt.category ?? ""),
    previewText: String(prompt.preview_text ?? prompt.previewText ?? ""),
    encryptedPrompt: String(prompt.encrypted_prompt ?? prompt.encryptedPrompt ?? ""),
    encryptionIv: String(prompt.encryption_iv ?? prompt.encryptionIv ?? ""),
    wrappedKey: String(prompt.wrapped_key ?? prompt.wrappedKey ?? ""),
    contentHash: toHex(prompt.content_hash ?? prompt.contentHash ?? ""),
    priceStroops: toBigInt(prompt.price_stroops ?? prompt.priceStroops ?? 0),
    active: toBoolean(prompt.active ?? false),
    salesCount: toNumber(prompt.sales_count ?? prompt.salesCount ?? 0),
  };
}

function normalizePromptList(value: unknown) {
  return unwrapContractResult<unknown[]>(value).map(normalizePrompt);
}

export async function getPrompt(config: PromptHashConfig, promptId: bigint) {
  const result = await readContract<unknown>(
    config,
    config.promptHashContractId,
    "get_prompt",
    [scValArg(promptId, "u128")],
  );

  return normalizePrompt(unwrapContractResult(result));
}

export async function getAllPrompts(config: PromptHashConfig) {
  const result = await readContract<unknown>(
    config,
    config.promptHashContractId,
    "get_all_prompts",
  );

  return normalizePromptList(result);
}

export async function getPromptsByCreator(
  config: PromptHashConfig,
  creator: string,
) {
  const result = await readContract<unknown>(
    config,
    config.promptHashContractId,
    "get_prompts_by_creator",
    [scValArg(creator, "address")],
  );

  return normalizePromptList(result);
}

export async function getPromptsByBuyer(config: PromptHashConfig, buyer: string) {
  const result = await readContract<unknown>(
    config,
    config.promptHashContractId,
    "get_prompts_by_buyer",
    [scValArg(buyer, "address")],
  );

  return normalizePromptList(result);
}

export async function hasAccess(
  config: PromptHashConfig,
  user: string,
  promptId: bigint,
) {
  const result = await readContract<unknown>(
    config,
    config.promptHashContractId,
    "has_access",
    [scValArg(user, "address"), scValArg(promptId, "u128")],
  );

  return toBoolean(unwrapContractResult(result));
}

export async function createPrompt(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  creator: string,
  input: CreatePromptInput,
) {
  const prepared = await prepareContractCall(
    config,
    creator,
    config.promptHashContractId,
    "create_prompt",
    [
      scValArg(creator, "address"),
      scValArg(input.imageUrl),
      scValArg(input.title),
      scValArg(input.category),
      scValArg(input.previewText),
      scValArg(input.encryptedPrompt),
      scValArg(input.encryptionIv),
      scValArg(input.wrappedKey),
      scValArg(Buffer.from(input.contentHash, "hex")),
      scValArg(input.priceStroops, "i128"),
    ],
  );

  const promptId = toBigInt(unwrapContractResult(readSimulationResult(prepared.simulation)));
  const submission = await submitPreparedTransaction(config, prepared, signer, creator);

  return {
    promptId,
    txHash: submission.txHash,
  };
}

export async function setPromptSaleStatus(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  creator: string,
  promptId: bigint,
  active: boolean,
) {
  const prepared = await prepareContractCall(
    config,
    creator,
    config.promptHashContractId,
    "set_prompt_sale_status",
    [
      scValArg(creator, "address"),
      scValArg(promptId, "u128"),
      scValArg(active),
    ],
  );

  return submitPreparedTransaction(config, prepared, signer, creator);
}

export async function updatePromptPrice(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  creator: string,
  promptId: bigint,
  priceStroops: bigint,
) {
  const prepared = await prepareContractCall(
    config,
    creator,
    config.promptHashContractId,
    "update_prompt_price",
    [
      scValArg(creator, "address"),
      scValArg(promptId, "u128"),
      scValArg(priceStroops, "i128"),
    ],
  );

  return submitPreparedTransaction(config, prepared, signer, creator);
}

export async function buyPromptAccess(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  buyer: string,
  promptId: bigint,
  priceStroops: bigint,
) {
  const latestLedger = await getRpcServer(config).getLatestLedger();

  await approveNativeAssetSpend(
    config,
    signer,
    buyer,
    config.promptHashContractId,
    priceStroops,
    latestLedger.sequence + 1_000,
  );

  const prepared = await prepareContractCall(
    config,
    buyer,
    config.promptHashContractId,
    "buy_prompt",
    [scValArg(buyer, "address"), scValArg(promptId, "u128")],
  );
  return submitPreparedTransaction(config, prepared, signer, buyer);
}
