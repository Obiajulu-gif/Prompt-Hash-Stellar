/**
 * Typed Soroban contract method wrappers for PromptHash.
 * Converts UI types → XDR arguments → contract invocations.
 * Real transaction building, simulation, signing, and submission.
 */

import {
  nativeToScVal,
  scValToNative,
  Address,
  type xdr,
} from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import {
  type StellarNetworkConfig,
  type WalletTransactionSigner,
  type PreparedContractCall,
  scValArg,
  readSimulationResult,
  prepareContractCall,
  submitPreparedTransaction,
  readContract,
} from "./tx";
import type {
  PromptHashConfig,
  PromptRecord,
  BundleRecord,
  AccessPassRecord,
} from "./promptHashClient";
import { normalizeContentHash } from "../crypto/promptCrypto";

// ============================================================================
// READ METHODS
// ============================================================================

export async function contractCheckAccess(
  config: PromptHashConfig,
  userAddress: string,
  promptId: bigint,
): Promise<boolean> {
  const args = [
    scValArg(new Address(userAddress).toScVal()),
    scValArg(promptId, "u64"),
  ];

  return readContract<boolean>(
    {
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      allowHttp: config.allowHttp,
      simulationAccount: config.simulationAccount,
    },
    config.promptHashContractId,
    "has_access",
    args,
  );
}

export async function contractGetPrompt(
  config: PromptHashConfig,
  promptId: bigint,
): Promise<PromptRecord> {
  const args = [scValArg(promptId, "u64")];

  const result = await readContract<Record<string, any>>(
    {
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      allowHttp: config.allowHttp,
      simulationAccount: config.simulationAccount,
    },
    config.promptHashContractId,
    "get_prompt",
    args,
  );

  return decodePromptRecord(result, promptId);
}

export async function contractGetAllPrompts(
  config: PromptHashConfig,
): Promise<PromptRecord[]> {
  const result = await readContract<Record<string, any>[]>(
    {
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      allowHttp: config.allowHttp,
      simulationAccount: config.simulationAccount,
    },
    config.promptHashContractId,
    "get_all_prompts",
    [],
  );

  return result.map((item, idx) => decodePromptRecord(item, BigInt(idx)));
}

export async function contractGetPromptsByCreator(
  config: PromptHashConfig,
  creatorAddress: string,
): Promise<PromptRecord[]> {
  const args = [scValArg(new Address(creatorAddress).toScVal())];

  const result = await readContract<Record<string, any>[]>(
    {
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      allowHttp: config.allowHttp,
      simulationAccount: config.simulationAccount,
    },
    config.promptHashContractId,
    "get_prompts_by_creator",
    args,
  );

  return result.map((item, idx) => decodePromptRecord(item, BigInt(idx)));
}

export async function contractGetPromptsByBuyer(
  config: PromptHashConfig,
  buyerAddress: string,
): Promise<PromptRecord[]> {
  // Note: The contract doesn't have get_prompts_by_buyer directly.
  // We need to query all prompts and filter by buyer access.
  // For now, return empty to match mock behavior, but mark as TODO for real implementation.
  // TODO: Implement by querying purchase history events or state.
  return [];
}

export async function contractGetBundlesByCreator(
  config: PromptHashConfig,
  creatorAddress: string,
): Promise<BundleRecord[]> {
  const args = [scValArg(new Address(creatorAddress).toScVal())];

  const result = await readContract<Record<string, any>[]>(
    {
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      allowHttp: config.allowHttp,
      simulationAccount: config.simulationAccount,
    },
    config.promptHashContractId,
    "get_bundles_by_creator",
    args,
  );

  return result.map((item, idx) => decodeBundleRecord(item, BigInt(idx)));
}

export async function contractGetAccessPassesByCreator(
  config: PromptHashConfig,
  creatorAddress: string,
): Promise<AccessPassRecord[]> {
  const args = [scValArg(new Address(creatorAddress).toScVal())];

  const result = await readContract<Record<string, any>[]>(
    {
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      allowHttp: config.allowHttp,
      simulationAccount: config.simulationAccount,
    },
    config.promptHashContractId,
    "get_access_passes_by_creator",
    args,
  );

  return result.map((item, idx) => decodeAccessPassRecord(item, BigInt(idx)));
}

// ============================================================================
// WRITE METHODS
// ============================================================================

export async function contractCreatePrompt(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  userAddress: string,
  data: {
    imageUrl: string;
    title: string;
    category: string;
    previewText: string;
    encryptedPrompt: string;
    encryptionIv: string;
    wrappedKey: string;
    contentHash: string;
    priceStroops: bigint;
    splits?: Array<{ recipient: string; bps: number }>;
  },
): Promise<{ txHash: string; success: boolean; promptId?: string }> {
  const splitsArg = (data.splits ?? []).map((split) =>
    scValArg(
      {
        recipient: new Address(split.recipient).toScVal(),
        bps: scValArg(split.bps, "u32"),
      },
      "Vec<Split>",
    ),
  );

  const args: xdr.ScVal[] = [
    scValArg(new Address(userAddress).toScVal()),
    scValArg(data.imageUrl),
    scValArg(data.title),
    scValArg(data.category),
    scValArg(data.previewText),
    scValArg(data.encryptedPrompt),
    scValArg(data.encryptionIv),
    scValArg(data.wrappedKey),
    scValArg(data.contentHash),
    scValArg(data.priceStroops, "i128"),
    scValArg(splitsArg, "Vec"),
  ];

  const prepared = await prepareContractCall(
    config as StellarNetworkConfig,
    userAddress,
    config.promptHashContractId,
    "create_prompt",
    args,
  );

  const txResult = await submitPreparedTransaction(
    config as StellarNetworkConfig,
    prepared,
    signer,
    userAddress,
  );

  return {
    txHash: txResult.hash,
    success: true,
    promptId: undefined, // Decoded from contract result if available
  };
}

export async function contractPurchasePrompt(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  buyerAddress: string,
  promptId: bigint,
): Promise<{ txHash: string; success: boolean }> {
  const args: xdr.ScVal[] = [
    scValArg(new Address(buyerAddress).toScVal()),
    scValArg(promptId, "u64"),
  ];

  const prepared = await prepareContractCall(
    config as StellarNetworkConfig,
    buyerAddress,
    config.promptHashContractId,
    "buy_prompt",
    args,
  );

  const txResult = await submitPreparedTransaction(
    config as StellarNetworkConfig,
    prepared,
    signer,
    buyerAddress,
  );

  return {
    txHash: txResult.hash,
    success: true,
  };
}

export async function contractPurchaseBundle(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  buyerAddress: string,
  bundleId: bigint,
): Promise<{ txHash: string; success: boolean }> {
  const args: xdr.ScVal[] = [
    scValArg(new Address(buyerAddress).toScVal()),
    scValArg(bundleId, "u128"),
  ];

  const prepared = await prepareContractCall(
    config as StellarNetworkConfig,
    buyerAddress,
    config.promptHashContractId,
    "buy_bundle",
    args,
  );

  const txResult = await submitPreparedTransaction(
    config as StellarNetworkConfig,
    prepared,
    signer,
    buyerAddress,
  );

  return {
    txHash: txResult.hash,
    success: true,
  };
}

export async function contractPurchaseAccessPass(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  buyerAddress: string,
  passId: bigint,
): Promise<{ txHash: string; success: boolean }> {
  const args: xdr.ScVal[] = [
    scValArg(new Address(buyerAddress).toScVal()),
    scValArg(passId, "u128"),
  ];

  const prepared = await prepareContractCall(
    config as StellarNetworkConfig,
    buyerAddress,
    config.promptHashContractId,
    "buy_access_pass",
    args,
  );

  const txResult = await submitPreparedTransaction(
    config as StellarNetworkConfig,
    prepared,
    signer,
    buyerAddress,
  );

  return {
    txHash: txResult.hash,
    success: true,
  };
}

export async function contractCreateBundle(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  creatorAddress: string,
  data: {
    title: string;
    promptIds: Array<string | bigint>;
    priceStroops: bigint;
    expiresAt?: number;
  },
): Promise<{ txHash: string; success: boolean; bundleId?: string }> {
  const promptIds = data.promptIds.map((id) =>
    typeof id === "string" ? BigInt(id) : id,
  );

  const args: xdr.ScVal[] = [
    scValArg(new Address(creatorAddress).toScVal()),
    scValArg(data.title),
    scValArg(promptIds, "Vec<u64>"),
    scValArg(data.priceStroops, "i128"),
    scValArg(data.expiresAt ?? 0, "u64"),
  ];

  const prepared = await prepareContractCall(
    config as StellarNetworkConfig,
    creatorAddress,
    config.promptHashContractId,
    "create_bundle",
    args,
  );

  const txResult = await submitPreparedTransaction(
    config as StellarNetworkConfig,
    prepared,
    signer,
    creatorAddress,
  );

  return {
    txHash: txResult.hash,
    success: true,
    bundleId: undefined,
  };
}

export async function contractCreateAccessPass(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  creatorAddress: string,
  data: {
    title: string;
    durationSecs: number;
    priceStroops: bigint;
  },
): Promise<{ txHash: string; success: boolean; passId?: string }> {
  const args: xdr.ScVal[] = [
    scValArg(new Address(creatorAddress).toScVal()),
    scValArg(data.title),
    scValArg(data.durationSecs, "u64"),
    scValArg(data.priceStroops, "i128"),
  ];

  const prepared = await prepareContractCall(
    config as StellarNetworkConfig,
    creatorAddress,
    config.promptHashContractId,
    "create_access_pass",
    args,
  );

  const txResult = await submitPreparedTransaction(
    config as StellarNetworkConfig,
    prepared,
    signer,
    creatorAddress,
  );

  return {
    txHash: txResult.hash,
    success: true,
    passId: undefined,
  };
}

export async function contractSetPromptSaleStatus(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  creatorAddress: string,
  promptId: bigint,
  active: boolean,
): Promise<{ txHash: string; success: boolean }> {
  const args: xdr.ScVal[] = [
    scValArg(new Address(creatorAddress).toScVal()),
    scValArg(promptId, "u64"),
    scValArg(active, "bool"),
  ];

  const prepared = await prepareContractCall(
    config as StellarNetworkConfig,
    creatorAddress,
    config.promptHashContractId,
    "set_prompt_sale_status",
    args,
  );

  const txResult = await submitPreparedTransaction(
    config as StellarNetworkConfig,
    prepared,
    signer,
    creatorAddress,
  );

  return {
    txHash: txResult.hash,
    success: true,
  };
}

export async function contractUpdatePromptPrice(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  creatorAddress: string,
  promptId: bigint,
  newPriceStroops: bigint,
): Promise<{ txHash: string; success: boolean }> {
  const args: xdr.ScVal[] = [
    scValArg(new Address(creatorAddress).toScVal()),
    scValArg(promptId, "u64"),
    scValArg(newPriceStroops, "i128"),
  ];

  const prepared = await prepareContractCall(
    config as StellarNetworkConfig,
    creatorAddress,
    config.promptHashContractId,
    "update_prompt_price",
    args,
  );

  const txResult = await submitPreparedTransaction(
    config as StellarNetworkConfig,
    prepared,
    signer,
    creatorAddress,
  );

  return {
    txHash: txResult.hash,
    success: true,
  };
}

export async function contractAdminSetPromptSaleStatus(
  config: PromptHashConfig,
  signer: WalletTransactionSigner,
  adminAddress: string,
  promptId: bigint,
  active: boolean,
): Promise<{ txHash: string; success: boolean }> {
  const args: xdr.ScVal[] = [
    scValArg(new Address(adminAddress).toScVal()),
    scValArg(promptId, "u64"),
    scValArg(active, "bool"),
  ];

  const prepared = await prepareContractCall(
    config as StellarNetworkConfig,
    adminAddress,
    config.promptHashContractId,
    "admin_set_prompt_sale_status",
    args,
  );

  const txResult = await submitPreparedTransaction(
    config as StellarNetworkConfig,
    prepared,
    signer,
    adminAddress,
  );

  return {
    txHash: txResult.hash,
    success: true,
  };
}

// ============================================================================
// DECODERS
// ============================================================================

export function decodePromptRecord(
  data: Record<string, any>,
  id: bigint,
): PromptRecord {
  return {
    id,
    creator: data.creator || "",
    priceStroops: BigInt(data.price || 0),
    title: data.title || "",
    category: data.category || "",
    previewText: data.preview_text || "",
    description: data.description || "",
    tags: data.tags || [],
    imageUrl: data.image_url || "",
    salesCount: data.sales_count || 0,
    active: data.active || false,
    contentHash: data.content_hash
      ? normalizeContentHash(data.content_hash)
      : "",
  };
}

function decodeBundleRecord(
  data: Record<string, any>,
  id: bigint,
): BundleRecord {
  return {
    id,
    creator: data.creator || "",
    title: data.title || "",
    promptIds: (data.prompt_ids || []).map((id: any) => BigInt(id)),
    priceStroops: BigInt(data.price || 0),
    active: data.active || false,
    salesCount: data.sales_count || 0,
    expiresAt: data.expires_at,
  };
}

function decodeAccessPassRecord(
  data: Record<string, any>,
  id: bigint,
): AccessPassRecord {
  return {
    id,
    creator: data.creator || "",
    title: data.title || "",
    durationSecs: data.duration_secs || 0,
    priceStroops: BigInt(data.price || 0),
    active: data.active || false,
    salesCount: data.sales_count || 0,
  };
}

/**
 * Dry-run validation for bulk purchases without state mutation.
 * Returns per-item validity status so frontend can filter invalid IDs before submitting.
 * No auth required (read-only check).
 *
 * Issue #438: Per-item error surfacing for bulk purchases.
 */
export async function contractValidateBulkPurchase(
  config: PromptHashConfig,
  buyerAddress: string,
  promptIds: bigint[],
  paymentAmounts: bigint[],
): Promise<boolean[]> {
  try {
    const idsVec = nativeToScVal(promptIds, {
      type: "vec",
      innerType: { type: "u64" },
    });
    const amountsVec = nativeToScVal(paymentAmounts, {
      type: "vec",
      innerType: { type: "i128" },
    });

    const args: xdr.ScVal[] = [
      scValArg(new Address(buyerAddress).toScVal()),
      scValArg(idsVec),
      scValArg(amountsVec),
    ];

    const result = await readContract(
      config as StellarNetworkConfig,
      config.promptHashContractId,
      "validate_bulk_purchase",
      args,
    );

    // Result is a vec<bool> from the contract
    const validity = scValToNative(result) as boolean[];
    return validity;
  } catch (error) {
    console.error("Error validating bulk purchase:", error);
    // Return all false on error (conservative fallback)
    return promptIds.map(() => false);
  }
}
