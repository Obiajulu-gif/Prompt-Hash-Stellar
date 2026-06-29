/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
/**
 * WARNING: MOCK CONTRACT IMPLEMENTATION
 * This file currently stubs all on-chain reads/writes with mock data.
 * This should NOT reach production.
 * TODO: Restore real Soroban contract integration before release.
 */
let hasWarnedMock = false;
const warnMockUse = () => {
  if (hasWarnedMock) return;
  console.warn(
    "âš ï¸ USING MOCK PromptHashClient: Contract calls are currently stubbed and will not hit the Stellar network.",
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

// Added the missing interface required by the UI
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

export class PromptHashClient {
  /**
   * Checks if the user already has access to the prompt.
   */
  static async checkAccess(
    _config: PromptHashConfig | string,
    _address: string,
    _itemId?: string | bigint,
  ): Promise<boolean> {
    warnMockUse();
    return new Promise((resolve) => {
      setTimeout(() => resolve(false), 1000);
    });
  }

  static async getPrompt(
    _config: PromptHashConfig,
    promptId: bigint,
  ): Promise<PromptRecord> {
    warnMockUse();
    const prompts = await PromptHashClient.getAllPrompts(_config);
    const match = prompts.find((p) => p.id === promptId);
    if (!match) {
      throw new Error(`Prompt #${promptId.toString()} not found.`);
    }
    return match;
  }

  /**
   * Invokes the Soroban contract to purchase a prompt.
   */
  static async purchasePrompt(
    _itemId: string,
    _userAddress: string,
    options?: { forceFailure?: string; delay?: number },
  ): Promise<{ txHash: string; success: boolean }> {
    warnMockUse();
    return new Promise((resolve, reject) => {
      const delay = options?.delay ?? 2000;
      setTimeout(() => {
        if (options?.forceFailure) {
          return reject(new Error(options.forceFailure));
        }

        const mockHash =
          "tx_" + Math.random().toString(16).slice(2, 14).padStart(12, "0");
        resolve({ txHash: mockHash, success: true });
      }, delay);
    });
  }

  static async getAllPrompts(
    _config: PromptHashConfig,
  ): Promise<PromptRecord[]> {
    warnMockUse();
    // Returning mock data so the Browse page isn't empty
    return [
      {
        id: 1n,
        creator: "GD...1234",
        priceStroops: 50000000n, // 5 XLM
        title: "GPT-4 Technical Architect",
        category: "Development",
        previewText:
          "A high-performance prompt for generating system design documents...",
        description:
          "A full prompt designed to help architects craft scalable system blueprints and integration plans.",
        tags: ["AI", "Architecture"],
        imageUrl: "",
        salesCount: 12,
        active: true,
        contentHash: "mock_hash_000000000001",
      },
      {
        id: 2n,
        creator: "GB...5678",
        priceStroops: 120000000n, // 12 XLM
        title: "Creative Storyteller Pro",
        category: "Creative",
        previewText:
          "Unlock deep narrative structures and character development...",
        description:
          "A storytelling prompt built to help craft plot outlines, characters, and emotional arcs for long-form fiction.",
        tags: ["Storytelling", "Creative"],
        imageUrl: "",
        salesCount: 45,
        active: true,
        contentHash: "mock_hash_000000000002",
      },
    ];
  }

  static async getPromptsByBuyer(
    _config: PromptHashConfig,
    _address: string,
  ): Promise<PromptRecord[]> {
    warnMockUse();
    return [];
  }

  static async getPromptsByCreator(
    _config: PromptHashConfig,
    _address: string,
  ): Promise<PromptRecord[]> {
    warnMockUse();
    return [];
  }

  static async createPrompt(
    _config: PromptHashConfig,
    _walletSignerLike: any,
    _address: string,
    _data: CreatePromptInput,
  ) {
    warnMockUse();
    return { success: true, txHash: "tx_mock", promptId: "123" };
  }

  static async setPromptSaleStatus(
    _config: PromptHashConfig,
    _walletSignerLike: any,
    _address: string,
    _promptId: string,
    _isForSale: boolean,
  ) {
    warnMockUse();
    return { success: true };
  }

  static async updatePromptPrice(
    _config: PromptHashConfig,
    _walletSignerLike: any,
    _address: string,
    _promptId: string,
    _newPrice: string,
  ) {
    warnMockUse();
    return { success: true };
  }
}

// --- Standalone exports to satisfy existing UI component imports ---
export const hasAccess = async (
  config: PromptHashConfig,
  address: string,
  itemId: string | bigint,
) =>
  PromptHashClient.checkAccess(
    config,
    address,
    typeof itemId === "bigint" ? itemId.toString() : itemId,
  );
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
  walletSignerLike: any,
  address: string,
  data: CreatePromptInput,
) => PromptHashClient.createPrompt(config, walletSignerLike, address, data);
export const setPromptSaleStatus = async (
  config: PromptHashConfig,
  walletSignerLike: any,
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
  walletSignerLike: any,
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
