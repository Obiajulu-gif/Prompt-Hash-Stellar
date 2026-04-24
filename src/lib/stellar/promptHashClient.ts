/**
 * WARNING: MOCK CONTRACT IMPLEMENTATION
 * This file currently stubs all on-chain reads/writes with mock data.
 * This should NOT reach production. 
 * TODO: Restore real Soroban contract integration before release.
 */
let hasWarnedMock = false;
const warnMockUse = () => {
  if (hasWarnedMock) return;
  console.warn("⚠️ USING MOCK PromptHashClient: Contract calls are currently stubbed and will not hit the Stellar network.");
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

export type CreatePromptInput = unknown;

export class PromptHashClient {
  /**
   * Checks if the user already has access to the prompt.
   */
  static async checkAccess(
    config: PromptHashConfig,
    address: string,
    itemId: string
  ): Promise<boolean> {
    warnMockUse();
    return new Promise((resolve) => {
      setTimeout(() => resolve(false), 1000); // Mock: Assume false initially
    });
  }

  /**
   * Invokes the Soroban contract to purchase a prompt.
   * Returns the transaction hash and a flag indicating if the user already owns the prompt.
   */
  static async purchasePrompt(
    itemId: string,
    userAddress: string,
    options?: { forceFailure?: string; delay?: number }
  ): Promise<{ txHash: string; success: boolean }> {
    warnMockUse();
    return new Promise((resolve, reject) => {
      const delay = options?.delay ?? 2000;
      setTimeout(() => {
        // TODO: Replace with actual Soroban contract invocation using @stellar/stellar-sdk
        // e.g. await contract.call("purchase_asset", { id: itemId });
        
        if (options?.forceFailure) {
          return reject(new Error(options.forceFailure));
        }
        
        if (import.meta.env?.DEV) {
          const rand = Math.random();
          if (rand < 0.1) return reject(new Error("op_underfunded"));
          if (rand < 0.2) return reject(new Error("tx_bad_seq"));
        }
        
        const mockHash = "tx_" + Math.random().toString(16).slice(2, 14).padStart(12, "0");
        resolve({ txHash: mockHash, success: true });
      }, delay);
    });
  }

  static async getAllPrompts(config: PromptHashConfig) {
    warnMockUse();
    return [];
  }

  static async getPromptsByBuyer(config: PromptHashConfig, address: string) {
    warnMockUse();
    return [];
  }

  static async getPromptsByCreator(config: PromptHashConfig, address: string) {
    warnMockUse();
    return [];
  }

  static async createPrompt(config: PromptHashConfig, walletSignerLike: any, address: string, data: CreatePromptInput) {
    warnMockUse();
    return { success: true, txHash: "tx_mock" };
  }

  static async setPromptSaleStatus(config: PromptHashConfig, walletSignerLike: any, address: string, promptId: string, isForSale: boolean) {
    warnMockUse();
    return { success: true };
  }

  static async updatePromptPrice(config: PromptHashConfig, walletSignerLike: any, address: string, promptId: string, newPrice: string) {
    warnMockUse();
    return { success: true };
  }
}

// --- Standalone exports to satisfy existing UI component imports ---
export const hasAccess = async (config: PromptHashConfig, address: string, itemId: string) => PromptHashClient.checkAccess(config, address, itemId);
export const getAllPrompts = async (config: PromptHashConfig) => PromptHashClient.getAllPrompts(config);
export const getPromptsByBuyer = async (config: PromptHashConfig, address: string) => PromptHashClient.getPromptsByBuyer(config, address);
export const getPromptsByCreator = async (config: PromptHashConfig, address: string) => PromptHashClient.getPromptsByCreator(config, address);
export const createPrompt = async (config: PromptHashConfig, walletSignerLike: any, address: string, data: CreatePromptInput) => PromptHashClient.createPrompt(config, walletSignerLike, address, data);
export const setPromptSaleStatus = async (config: PromptHashConfig, walletSignerLike: any, address: string, promptId: string, isForSale: boolean) => PromptHashClient.setPromptSaleStatus(config, walletSignerLike, address, promptId, isForSale);
export const updatePromptPrice = async (config: PromptHashConfig, walletSignerLike: any, address: string, promptId: string, newPrice: string) => PromptHashClient.updatePromptPrice(config, walletSignerLike, address, promptId, newPrice);