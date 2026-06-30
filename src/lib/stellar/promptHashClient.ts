import { xdr } from "@stellar/stellar-sdk";
import { approveNativeAssetSpend } from "./nativeAssetClient";
import {
  getRpcServer,
  prepareContractCall,
  readContract,
  scValArg,
  submitPreparedTransaction,
  type WalletTransactionSigner,
} from "./tx";

let hasWarnedMock = false;
const warnMockUse = () => {
  if (hasWarnedMock) return;
  console.warn(
    "Using mock PromptHashClient data because contract configuration is incomplete.",
  );
  hasWarnedMock = true;
};

export interface PromptHashConfig {
  rpcUrl: string;
  networkPassphrase: string;
  allowHttp?: boolean;
  promptHashContractId: string;
  nativeAssetContractId: string;
  simulationAccount?: string;
}

export interface PromptRecord {
  id: bigint;
  creator: string;
  priceStroops: bigint;
  title: string;
  category: string;
  previewText: string;
  description?: string;
  tags?: string[];
  imageUrl: string;
  salesCount: number;
  active: boolean;
  contentHash: string;
  encryptedPrompt?: string;
  encryptionIv?: string;
  wrappedKey?: string;
  revision?: number;
  maxSupply?: number;
  expiresAt?: number;
  asset?: string;
}

export interface RevenueSplitInput {
  recipient: string;
  bps: number;
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
  splits?: RevenueSplitInput[];
}

export interface PurchasePromptOptions {
  config?: PromptHashConfig;
  signer?: WalletTransactionSigner;
  forceFailure?: string;
  delay?: number;
}

export interface PurchasePromptResult {
  txHash: string;
  approvalTxHash?: string;
  success: boolean;
  confirmedAtLedger?: number;
}

type ContractPrompt = Record<string, unknown>;

function isContractReady(config: PromptHashConfig): boolean {
  return Boolean(
    config.rpcUrl &&
      config.promptHashContractId &&
      config.nativeAssetContractId &&
      config.simulationAccount,
  );
}

function readField<T>(value: ContractPrompt, key: string, fallback: T): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : fallback;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function normalizeTags(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function normalizeHash(value: unknown): string {
  if (value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  return String(value ?? "");
}

function normalizePrompt(prompt: ContractPrompt): PromptRecord {
  return {
    id: BigInt(String(readField(prompt, "id", 0))),
    creator: String(readField(prompt, "creator", "")),
    priceStroops: BigInt(
      String(readField(prompt, "price_stroops", readField(prompt, "priceStroops", 0))),
    ),
    title: String(readField(prompt, "title", "Untitled prompt")),
    category: String(readField(prompt, "category", "General")),
    previewText: String(
      readField(prompt, "preview_text", readField(prompt, "previewText", "")),
    ),
    description: optionalString(readField(prompt, "description", undefined)),
    tags: normalizeTags(readField(prompt, "tags", [])),
    imageUrl: String(
      readField(prompt, "image_url", readField(prompt, "imageUrl", "")),
    ),
    salesCount: Number(
      readField(prompt, "sales_count", readField(prompt, "salesCount", 0)),
    ),
    active: Boolean(readField(prompt, "active", true)),
    contentHash: normalizeHash(
      readField(prompt, "content_hash", readField(prompt, "contentHash", "")),
    ),
    encryptedPrompt: optionalString(
      readField(
        prompt,
        "encrypted_prompt",
        readField(prompt, "encryptedPrompt", undefined),
      ),
    ),
    encryptionIv: optionalString(
      readField(prompt, "encryption_iv", readField(prompt, "encryptionIv", undefined)),
    ),
    wrappedKey: optionalString(
      readField(prompt, "wrapped_key", readField(prompt, "wrappedKey", undefined)),
    ),
    revision: Number(readField(prompt, "revision", 0)),
    maxSupply: Number(
      readField(prompt, "max_supply", readField(prompt, "maxSupply", 0)),
    ),
    expiresAt: Number(
      readField(prompt, "expires_at", readField(prompt, "expiresAt", 0)),
    ),
    asset: optionalString(readField(prompt, "asset", undefined)),
  };
}

const mockPrompts: PromptRecord[] = [
  {
    id: 1n,
    creator: "GD...1234",
    priceStroops: 50_0000000n,
    title: "GPT-4 Technical Architect",
    category: "Development",
    previewText:
      "A high-performance prompt for generating system design documents.",
    description:
      "A full prompt designed to help architects craft scalable system blueprints and integration plans.",
    tags: ["AI", "Architecture"],
    imageUrl: "",
    salesCount: 12,
    active: true,
    contentHash: "mock_hash_000000000001",
    revision: 0,
  },
  {
    id: 2n,
    creator: "GB...5678",
    priceStroops: 120_0000000n,
    title: "Creative Storyteller Pro",
    category: "Creative",
    previewText:
      "Unlock deep narrative structures and character development.",
    description:
      "A storytelling prompt built to help craft plot outlines, characters, and emotional arcs for long-form fiction.",
    tags: ["Storytelling", "Creative"],
    imageUrl: "",
    salesCount: 45,
    active: true,
    contentHash: "mock_hash_000000000002",
    revision: 0,
  },
];

export class PromptHashClient {
  static async checkAccess(
    configOrItemId: PromptHashConfig | string,
    address: string,
    itemId?: string | bigint,
  ): Promise<boolean> {
    const config =
      typeof configOrItemId === "string" ? undefined : configOrItemId;
    const promptId = typeof configOrItemId === "string" ? configOrItemId : itemId;

    if (!config || !isContractReady(config) || !promptId) {
      warnMockUse();
      return new Promise((resolve) => {
        setTimeout(() => resolve(false), 250);
      });
    }

    return readContract<boolean>(
      config,
      config.promptHashContractId,
      "has_access",
      [scValArg(address, "address"), scValArg(BigInt(promptId), "u64")],
    );
  }

  static async getPrompt(
    config: PromptHashConfig,
    promptId: bigint,
  ): Promise<PromptRecord> {
    if (isContractReady(config)) {
      const prompt = await readContract<ContractPrompt>(
        config,
        config.promptHashContractId,
        "get_prompt",
        [scValArg(promptId, "u64")],
      );
      return normalizePrompt(prompt);
    }

    warnMockUse();
    const match = mockPrompts.find((p) => p.id === promptId);
    if (!match) {
      throw new Error(`Prompt #${promptId.toString()} not found.`);
    }
    return match;
  }

  static async purchasePrompt(
    itemId: string,
    userAddress: string,
    options?: PurchasePromptOptions,
  ): Promise<PurchasePromptResult> {
    if (options?.forceFailure) {
      throw new Error(options.forceFailure);
    }

    if (options?.config && options.signer && isContractReady(options.config)) {
      const config = options.config;
      const prompt = await PromptHashClient.getPrompt(config, BigInt(itemId));
      const amount = prompt.priceStroops;
      const server = getRpcServer(config);
      const latestLedger = await server.getLatestLedger();
      const expirationLedger = Number(latestLedger.sequence) + 1200;

      const approval = await approveNativeAssetSpend(
        config,
        options.signer,
        userAddress,
        config.promptHashContractId,
        amount,
        expirationLedger,
      );

      const prepared = await prepareContractCall(
        config,
        userAddress,
        config.promptHashContractId,
        "buy_prompt",
        [
          scValArg(userAddress, "address"),
          scValArg(BigInt(itemId), "u64"),
          xdr.ScVal.scvVoid(),
          scValArg(amount, "i128"),
          xdr.ScVal.scvVoid(),
        ],
      );
      const purchase = await submitPreparedTransaction(
        config,
        prepared,
        options.signer,
        userAddress,
      );

      return {
        txHash: purchase.txHash,
        approvalTxHash: approval.txHash,
        success: true,
        confirmedAtLedger: purchase.ledger,
      };
    }

    warnMockUse();
    return new Promise((resolve) => {
      const delay = options?.delay ?? 2000;
      setTimeout(() => {
        const mockHash =
          "tx_" + Math.random().toString(16).slice(2, 14).padStart(12, "0");
        resolve({ txHash: mockHash, success: true });
      }, delay);
    });
  }

  static async getAllPrompts(
    config: PromptHashConfig,
  ): Promise<PromptRecord[]> {
    if (isContractReady(config)) {
      const prompts = await readContract<ContractPrompt[]>(
        config,
        config.promptHashContractId,
        "get_all_prompts",
      );
      return prompts.map(normalizePrompt);
    }

    warnMockUse();
    return mockPrompts;
  }

  static async getPromptsByBuyer(
    config: PromptHashConfig,
    address: string,
  ): Promise<PromptRecord[]> {
    if (isContractReady(config)) {
      const prompts = await readContract<ContractPrompt[]>(
        config,
        config.promptHashContractId,
        "get_prompts_by_buyer",
        [scValArg(address, "address")],
      );
      return prompts.map(normalizePrompt);
    }
    warnMockUse();
    return [];
  }

  static async getPromptsByCreator(
    config: PromptHashConfig,
    address: string,
  ): Promise<PromptRecord[]> {
    if (isContractReady(config)) {
      const prompts = await readContract<ContractPrompt[]>(
        config,
        config.promptHashContractId,
        "get_prompts_by_creator",
        [scValArg(address, "address")],
      );
      return prompts.map(normalizePrompt);
    }
    warnMockUse();
    return [];
  }

  static async createPrompt(
    _config: PromptHashConfig,
    _walletSignerLike: WalletTransactionSigner,
    _address: string,
    _data: CreatePromptInput,
  ) {
    warnMockUse();
    return { success: true, txHash: "tx_mock", promptId: "123" };
  }

  static async setPromptSaleStatus(
    _config: PromptHashConfig,
    _walletSignerLike: WalletTransactionSigner,
    _address: string,
    _promptId: string,
    _isForSale: boolean,
  ) {
    warnMockUse();
    return { success: true };
  }

  static async updatePromptPrice(
    _config: PromptHashConfig,
    _walletSignerLike: WalletTransactionSigner,
    _address: string,
    _promptId: string,
    _newPrice: string,
  ) {
    warnMockUse();
    return { success: true };
  }
}

export const hasAccess = async (
  config: PromptHashConfig,
  address: string,
  itemId: string | bigint,
) => PromptHashClient.checkAccess(config, address, itemId);
export const getPrompt = async (config: PromptHashConfig, promptId: bigint) =>
  PromptHashClient.getPrompt(config, promptId);
export const getAllPrompts = async (config: PromptHashConfig) =>
  PromptHashClient.getAllPrompts(config);
export const getPromptsByBuyer = async (
  config: PromptHashConfig,
  address: string,
) => PromptHashClient.getPromptsByBuyer(config, address);
export const getPromptsByCreator = async (
  config: PromptHashConfig,
  address: string,
) => PromptHashClient.getPromptsByCreator(config, address);
export const createPrompt = async (
  config: PromptHashConfig,
  walletSignerLike: WalletTransactionSigner,
  address: string,
  data: CreatePromptInput,
) => PromptHashClient.createPrompt(config, walletSignerLike, address, data);
export const setPromptSaleStatus = async (
  config: PromptHashConfig,
  walletSignerLike: WalletTransactionSigner,
  address: string,
  promptId: string,
  isForSale: boolean,
) =>
  PromptHashClient.setPromptSaleStatus(
    config,
    walletSignerLike,
    address,
    promptId,
    isForSale,
  );
export const updatePromptPrice = async (
  config: PromptHashConfig,
  walletSignerLike: WalletTransactionSigner,
  address: string,
  promptId: string,
  newPrice: string,
) =>
  PromptHashClient.updatePromptPrice(
    config,
    walletSignerLike,
    address,
    promptId,
    newPrice,
  );
export const buyPromptAccess = async (
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  address: string,
  itemId: string | bigint,
) =>
  PromptHashClient.purchasePrompt(String(itemId), address, {
    config,
    signer,
  });
