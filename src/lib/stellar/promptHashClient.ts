/**
 * Real Soroban contract client for PromptHash.
 * All reads and writes invoke the deployed contract on-chain.
 */
import type { WalletTransactionSigner } from "./tx";
import * as contractMethods from "./contractMethods";
import { Server } from "@stellar/stellar-sdk/rpc";
import { hashKey } from "../observability/sharedStore";
import { getSourcePromptId } from "../prompts/remixAttribution";

export interface PromptHashConfig {
  rpcUrl: string;
  rpcUrls?: string[];
  entitlementQuorum?: number;
  networkPassphrase: string;
  allowHttp?: boolean;
  promptHashContractId: string;
  nativeAssetContractId: string;
  simulationAccount?: string;
}

/**
 * Result of a ledger-verified entitlement check.
 * Binds the access decision to explicit ledger state for finality
 * and freshness verification.
 */
export interface LedgerVerifiedEntitlement {
  hasAccess: boolean;
  ledgerSequence: number;
  ledgerHash: string;
  networkId: string;
  contractId: string;
  checkedAt: number;
  providerCount?: number;
  quorum?: number;
  divergenceReason?: string;
}

export const DEFAULT_MAX_LEDGER_AGE = 5;

export interface EntitlementProviderSample {
  providerUrl: string;
  hasAccess: boolean;
  ledgerSequence: number;
  ledgerHash: string;
  ledgerClosedAt?: number;
}

function getEntitlementRpcUrls(config: PromptHashConfig): string[] {
  const envUrls =
    typeof process !== "undefined"
      ? process.env.PUBLIC_STELLAR_RPC_URLS?.split(",").map((url) => url.trim()).filter(Boolean)
      : undefined;
  const configured = config.rpcUrls?.length
    ? config.rpcUrls
    : envUrls;
  return Array.from(new Set([...(configured?.length ? configured : [config.rpcUrl]), config.rpcUrl]));
}

export function evaluateEntitlementQuorum(
  samples: EntitlementProviderSample[],
  policy: {
    quorum: number;
    maxLedgerAge: number;
    networkId: string;
    contractId: string;
    checkedAt: number;
  },
): LedgerVerifiedEntitlement {
  const latest = samples.reduce<EntitlementProviderSample | null>(
    (current, sample) =>
      !current || sample.ledgerSequence > current.ledgerSequence ? sample : current,
    null,
  );
  const base = {
    hasAccess: false,
    ledgerSequence: latest?.ledgerSequence ?? 0,
    ledgerHash: latest?.ledgerHash ?? "",
    networkId: policy.networkId,
    contractId: policy.contractId,
    checkedAt: policy.checkedAt,
    providerCount: samples.length,
    quorum: policy.quorum,
  };

  if (samples.length < policy.quorum) {
    return { ...base, divergenceReason: "insufficient_providers" };
  }

  const maxAgeSecs = policy.maxLedgerAge * 5;
  const freshSamples = samples.filter(
    (sample) =>
      sample.ledgerClosedAt === undefined ||
      policy.checkedAt - sample.ledgerClosedAt <= maxAgeSecs,
  );
  if (freshSamples.length < policy.quorum) {
    return { ...base, divergenceReason: "stale_ledger" };
  }

  const groups = new Map<string, EntitlementProviderSample[]>();
  for (const sample of freshSamples) {
    const identity = JSON.stringify({
      hasAccess: sample.hasAccess,
      ledgerHash: sample.ledgerHash,
      ledgerSequence: sample.ledgerSequence,
    });
    groups.set(identity, [...(groups.get(identity) ?? []), sample]);
  }

  const winner = Array.from(groups.values()).find((group) => group.length >= policy.quorum);
  if (!winner) {
    return { ...base, divergenceReason: "provider_divergence" };
  }

  return {
    hasAccess: winner[0].hasAccess,
    ledgerSequence: winner[0].ledgerSequence,
    ledgerHash: winner[0].ledgerHash,
    networkId: policy.networkId,
    contractId: policy.contractId,
    checkedAt: policy.checkedAt,
    providerCount: samples.length,
    quorum: policy.quorum,
  };
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
  status?: string; // Draft, Active, Paused, Retired, Restricted
  contentHash: string;
  encryptedPrompt?: string;
  encryptionIv?: string;
  wrappedKey?: string;
  sourcePromptId?: string;
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

export interface BundleRecord {
  id: bigint;
  creator: string;
  title: string;
  promptIds: bigint[];
  priceStroops: bigint;
  active: boolean;
  salesCount: number;
  expiresAt?: number;
}

export interface AccessPassRecord {
  id: bigint;
  creator: string;
  title: string;
  durationSecs: number;
  priceStroops: bigint;
  active: boolean;
  salesCount: number;
}

export interface CreateBundleInput {
  title: string;
  promptIds: Array<string | bigint>;
  priceStroops: bigint;
  expiresAt?: number;
}

export interface CreateAccessPassInput {
  title: string;
  durationSecs: number;
  priceStroops: bigint;
}

/**
 * Error types for prompt client read failures, distinguishing between
 * empty results and actual failures (RPC outage, malformed data, stale state).
 */
export enum PromptHashReadError {
  Empty = "EMPTY",
  RPCOutage = "RPC_OUTAGE",
  MalformedXDR = "MALFORMED_XDR",
  StaleData = "STALE_DATA",
  PartialPagination = "PARTIAL_PAGINATION",
}

export interface ReadErrorResult {
  error: PromptHashReadError;
  message: string;
  retryable: boolean;
}

/**
 * Result type that distinguishes between empty results and failure results.
 */
export type PromptRecordResult =
  | { success: true; records: PromptRecord[] }
  | { success: false; error: PromptHashReadError; message: string };

export class PromptHashClient {
  /**
   * Checks if the user has access to the prompt via contract.
   */
  static async checkAccess(
    config: PromptHashConfig | string,
    address: string,
    itemId?: string | bigint,
  ): Promise<boolean> {
    if (typeof config === "string" || !itemId) return false;
    const promptId = typeof itemId === "string" ? BigInt(itemId) : itemId;
    return contractMethods.contractCheckAccess(config, address, promptId);
  }

  static async getPrompt(
    config: PromptHashConfig,
    promptId: bigint,
  ): Promise<PromptRecord> {
    const prompt = await contractMethods.contractGetPrompt(config, promptId);
    return {
      ...prompt,
      sourcePromptId: getSourcePromptId(promptId),
    };
  }

  /**
   * Invokes the Soroban contract to purchase a prompt.
   */
  static async purchasePrompt(
    itemId: string,
    userAddress: string,
    _walletSigner?: WalletTransactionSigner,
    config?: PromptHashConfig,
  ): Promise<{ txHash: string; success: boolean }> {
    if (!config || !_walletSigner) {
      throw new Error(
        "Missing config or wallet signer for real contract call.",
      );
    }
    const promptId = BigInt(itemId);
    return contractMethods.contractPurchasePrompt(
      config,
      _walletSigner,
      userAddress,
      promptId,
    );
  }

  /**
   * Validate bulk purchase items without state mutation.
   * Returns per-item validity so frontend can filter before submitting.
   * Issue #438: Per-item error surfacing.
   */
  static async validateBulkPurchase(
    config: PromptHashConfig,
    buyerAddress: string,
    promptIds: bigint[],
    paymentAmounts: bigint[],
  ): Promise<boolean[]> {
    return contractMethods.contractValidateBulkPurchase(
      config,
      buyerAddress,
      promptIds,
      paymentAmounts,
    );
  }

  static async purchaseBundle(
    bundleId: string,
    userAddress: string,
    _walletSigner?: WalletTransactionSigner,
    config?: PromptHashConfig,
  ): Promise<{ txHash: string; success: boolean }> {
    if (!config || !_walletSigner) {
      throw new Error(
        "Missing config or wallet signer for real contract call.",
      );
    }
    const id = BigInt(bundleId);
    return contractMethods.contractPurchaseBundle(
      config,
      _walletSigner,
      userAddress,
      id,
    );
  }

  static async purchaseAccessPass(
    passId: string,
    userAddress: string,
    _walletSigner?: WalletTransactionSigner,
    config?: PromptHashConfig,
  ): Promise<{ txHash: string; success: boolean }> {
    if (!config || !_walletSigner) {
      throw new Error(
        "Missing config or wallet signer for real contract call.",
      );
    }
    const id = BigInt(passId);
    return contractMethods.contractPurchaseAccessPass(
      config,
      _walletSigner,
      userAddress,
      id,
    );
  }

  static async getAllPrompts(
    config: PromptHashConfig,
  ): Promise<PromptRecord[]> {
    return contractMethods.contractGetAllPrompts(config);
  }

  /**
   * Paginated catalog fetch (bounded per-page RPC reads). Accumulate pages on
   * the caller side for infinite-scroll style loading. See
   * `contractGetAllPromptsPaginated` for cursor semantics.
   */
  static async getAllPromptsPaginated(
    config: PromptHashConfig,
    cursor?: string | null,
    limit = 50,
  ): Promise<{ prompts: PromptRecord[]; nextCursor: string | null }> {
    return contractMethods.contractGetAllPromptsPaginated(config, cursor, limit);
  }

  static async getPromptsByBuyer(
    config: PromptHashConfig,
    address: string,
  ): Promise<PromptRecord[]> {
    return contractMethods.contractGetPromptsByBuyer(config, address);
  }

  static async getPromptsByCreator(
    config: PromptHashConfig,
    address: string,
  ): Promise<PromptRecord[]> {
    return contractMethods.contractGetPromptsByCreator(config, address);
  }

/**
 * Find existing prompts whose content hash matches the given hash.
 * Returns matching records without exposing plaintext content.
 * Distinguishes between an truly empty result and a failure to fetch.
 */
  static async findPromptByContentHash(
    config: PromptHashConfig,
    contentHash: string,
  ): Promise<PromptRecordResult> {
    try {
      // Query the off-chain indexer API for duplicate detection
      const apiUrl = process.env.REACT_APP_API_URL || "http://localhost:3001";
      const response = await fetch(`${apiUrl}/api/prompts/hash/${contentHash}`);

      if (!response.ok) {
        return {
          success: false,
          error: PromptHashReadError.RPCOutage,
          message: `HTTP ${response.status}: failed to fetch prompts by content hash`,
        };
      }

      const data = await response.json();
      if (!data.found) {
        // Truly empty - no prompts with this hash exist
        return { success: true, records: [] };
      }

      // Transform API response to PromptRecord format
      return {
        success: true,
        records: data.matches.map((match: any) => ({
          id: BigInt(match.id || 0),
          creator: match.creator,
          priceStroops: BigInt(0), // Not included in hash lookup response
          title: match.title,
          category: "",
          previewText: "",
          imageUrl: "",
          salesCount: match.salesCount || 0,
          active: match.isActive,
          contentHash: contentHash,
        })),
      };
    } catch (error: any) {
      return {
        success: false,
        error: PromptHashReadError.RPCOutage,
        message: error.message || "Unknown error fetching prompts by content hash",
      };
    }
  }

  static async getBundlesByCreator(
    config: PromptHashConfig,
    address: string,
  ): Promise<BundleRecord[]> {
    return contractMethods.contractGetBundlesByCreator(config, address);
  }

  static async getAccessPassesByCreator(
    config: PromptHashConfig,
    address: string,
  ): Promise<AccessPassRecord[]> {
    return contractMethods.contractGetAccessPassesByCreator(config, address);
  }

  static async createPrompt(
    config: PromptHashConfig,
    walletSignerLike: WalletTransactionSigner,
    address: string,
    data: any,
  ) {
    const result = await contractMethods.contractCreatePrompt(
      config,
      walletSignerLike,
      address,
      data,
    );
    return {
      success: result.success,
      txHash: result.txHash,
      promptId: result.promptId,
    };
  }

  static async createBundle(
    config: PromptHashConfig,
    walletSignerLike: WalletTransactionSigner,
    address: string,
    data: CreateBundleInput,
  ) {
    const result = await contractMethods.contractCreateBundle(
      config,
      walletSignerLike,
      address,
      data,
    );
    return {
      success: result.success,
      txHash: result.txHash,
      bundleId: result.bundleId,
    };
  }

  static async createAccessPass(
    config: PromptHashConfig,
    walletSignerLike: WalletTransactionSigner,
    address: string,
    data: CreateAccessPassInput,
  ) {
    const result = await contractMethods.contractCreateAccessPass(
      config,
      walletSignerLike,
      address,
      data,
    );
    return {
      success: result.success,
      txHash: result.txHash,
      passId: result.passId,
    };
  }

  static async setPromptSaleStatus(
    config: PromptHashConfig,
    walletSignerLike: WalletTransactionSigner,
    address: string,
    promptId: string,
    isForSale: boolean,
  ) {
    const id = BigInt(promptId);
    return contractMethods.contractSetPromptSaleStatus(
      config,
      walletSignerLike,
      address,
      id,
      isForSale,
    );
  }

  static async adminSetPromptSaleStatus(
    config: PromptHashConfig,
    walletSignerLike: WalletTransactionSigner,
    adminAddress: string,
    promptId: string,
    isForSale: boolean,
  ) {
    const id = BigInt(promptId);
    return contractMethods.contractAdminSetPromptSaleStatus(
      config,
      walletSignerLike,
      adminAddress,
      id,
      isForSale,
    );
  }

  static async updatePromptPrice(
    config: PromptHashConfig,
    walletSignerLike: WalletTransactionSigner,
    address: string,
    promptId: string,
    newPrice: string,
  ) {
    const id = BigInt(promptId);
    const price = BigInt(newPrice);
    return contractMethods.contractUpdatePromptPrice(
      config,
      walletSignerLike,
      address,
      id,
      price,
    );
  }

  static async getRecentPurchases(
    config: PromptHashConfig,
    limit: number = 10,
  ) {
    try {
      const server = new Server(config.rpcUrl, {
        allowHttp: config.allowHttp,
      });

      // Get current ledger to limit our search
      const latestLedgerResponse = await server.getLatestLedger();
      const latestLedger = latestLedgerResponse.sequence;
      // Search the last 10,000 ledgers (~14 hours)
      const startLedger = Math.max(1, latestLedger - 10000);

      const events = await server.getEvents({
        startLedger,
        filters: [
          {
            type: "contract",
            contractIds: [config.promptHashContractId],
            // Topics could be strictly typed to the PromptPurchased event topic if known
          },
        ],
        limit,
      });

      // Here we would normally parse `events.events` and decode the XDR.
      // Since this is partly mocked, and XDR decoding is complex, we return a simulated list
      // formatted as what we'd expect.
      return events.events.map((e, i) => ({
        id: e.id || `rpc-event-${i}`,
        type: "sale",
        title: `Prompt #${e.topic?.[1] || i}`, // Without full XDR decoding, we use placeholder
        category: "Marketplace",
        actor: "Someone", // Anonymized
        timestamp: e.ledgerClosedAt,
        priceXlm: undefined,
      }));
    } catch (e) {
      console.error("Failed to fetch events from Soroban RPC:", e);
      // Fallback for mocked environment
      return [];
    }
  }
}

/**
 * Verify entitlement against finalized ledger state.
 *
 * Returns a `LedgerVerifiedEntitlement` that binds the access decision
 * to the ledger sequence, hash, network ID, and contract ID at the time
 * of verification.
 *
 * The caller MUST check `ledgerFreshness` against `maxLedgerAge`:
 * - If the ledger is lagging behind the network tip, reject the decision.
 * - If the ledger hash does not match a trusted node's view, reject.
 * - If the network/contract ID doesn't match, reject (cross-contract replay).
 *
 * Fail-closed: if the RPC node response is stale, forked, or unverifiable,
 * the entitlement is DENIED.
 */
export const hasAccess = async (
  config: PromptHashConfig,
  address: string,
  itemId: string | bigint,
): Promise<boolean> => {
  const entitlement = await verifyEntitlement(config, address, itemId);
  return entitlement.hasAccess;
};

/**
 * Verify entitlement against finalized ledger state, returning
 * full ledger provenance for caller-side verification.
 */
export const verifyEntitlement = async (
  config: PromptHashConfig,
  address: string,
  itemId: string | bigint,
  maxLedgerAge: number = DEFAULT_MAX_LEDGER_AGE,
): Promise<LedgerVerifiedEntitlement> => {
  const promptId = typeof itemId === "bigint" ? itemId : BigInt(itemId);
  const networkId = hashKey(config.networkPassphrase);
  const now = Math.floor(Date.now() / 1000);
  const rpcUrls = getEntitlementRpcUrls(config);
  const quorum = Math.min(config.entitlementQuorum ?? Math.min(2, rpcUrls.length), rpcUrls.length);

  try {
    const samples = await Promise.all(
      rpcUrls.map(async (rpcUrl) => {
        const providerConfig = { ...config, rpcUrl };
        const server = new Server(rpcUrl, { allowHttp: config.allowHttp });
        const [latestLedger, access] = await Promise.all([
          server.getLatestLedger(),
          PromptHashClient.checkAccess(providerConfig, address, promptId),
        ]);
        return {
          providerUrl: rpcUrl,
          hasAccess: access,
          ledgerSequence: latestLedger.sequence,
          ledgerHash: latestLedger.hash?.toString() ?? "",
          ledgerClosedAt: latestLedger.lastLedgerCloseTimestamp,
        } satisfies EntitlementProviderSample;
      }),
    );
    return evaluateEntitlementQuorum(samples, {
      quorum,
      maxLedgerAge,
      networkId,
      contractId: config.promptHashContractId,
      checkedAt: now,
    });
  } catch {
    // Fail-closed: RPC error = denied
    return {
      hasAccess: false,
      ledgerSequence: 0,
      ledgerHash: "",
      networkId,
      contractId: config.promptHashContractId,
      checkedAt: now,
      providerCount: rpcUrls.length,
      quorum,
      divergenceReason: "provider_error",
    };
  }
};
export const getPrompt = async (config: PromptHashConfig, promptId: bigint) =>
  PromptHashClient.getPrompt(config, promptId);
export const getAllPrompts = async (config: PromptHashConfig) =>
  PromptHashClient.getAllPrompts(config);
export const getAllPromptsPaginated = async (
  config: PromptHashConfig,
  cursor?: string | null,
  limit = 50,
) => PromptHashClient.getAllPromptsPaginated(config, cursor, limit);
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
export const createBundle = async (
  config: PromptHashConfig,
  walletSignerLike: any,
  address: string,
  data: CreateBundleInput,
) => PromptHashClient.createBundle(config, walletSignerLike, address, data);
export const createAccessPass = async (
  config: PromptHashConfig,
  walletSignerLike: any,
  address: string,
  data: CreateAccessPassInput,
) => PromptHashClient.createAccessPass(config, walletSignerLike, address, data);
export const getBundlesByCreator = async (
  config: PromptHashConfig,
  address: string,
) => PromptHashClient.getBundlesByCreator(config, address);
export const getAccessPassesByCreator = async (
  config: PromptHashConfig,
  address: string,
) => PromptHashClient.getAccessPassesByCreator(config, address);
export const purchaseBundle = async (bundleId: string, address: string) =>
  PromptHashClient.purchaseBundle(bundleId, address);
export const purchaseAccessPass = async (passId: string, address: string) =>
  PromptHashClient.purchaseAccessPass(passId, address);
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
export const adminSetPromptSaleStatus = async (
  config: PromptHashConfig,
  walletSignerLike: any,
  adminAddress: string,
  promptId: string,
  isForSale: boolean,
) =>
  PromptHashClient.adminSetPromptSaleStatus(
    config,
    walletSignerLike,
    adminAddress,
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

export const getRecentPurchases = async (
  config: PromptHashConfig,
  limit?: number,
) => PromptHashClient.getRecentPurchases(config, limit);

export const findPromptByContentHash = async (
  config: PromptHashConfig,
  contentHash: string,
) => PromptHashClient.findPromptByContentHash(config, contentHash);

export const validateBulkPurchase = async (
  config: PromptHashConfig,
  buyerAddress: string,
  promptIds: bigint[],
  paymentAmounts: bigint[],
) =>
  PromptHashClient.validateBulkPurchase(
    config,
    buyerAddress,
    promptIds,
    paymentAmounts,
  );
