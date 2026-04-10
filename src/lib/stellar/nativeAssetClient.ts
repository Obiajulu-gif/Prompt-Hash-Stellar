import { scValArg, prepareContractCall, submitPreparedTransaction, type StellarNetworkConfig, type WalletTransactionSigner } from "./tx";

export interface NativeAssetConfig extends StellarNetworkConfig {
  nativeAssetContractId: string;
}

export async function approveNativeAssetSpend(
  config: NativeAssetConfig,
  signer: WalletTransactionSigner,
  owner: string,
  spender: string,
  amount: bigint,
  expirationLedger: number,
) {
  const prepared = await prepareContractCall(
    config,
    owner,
    config.nativeAssetContractId,
    "approve",
    [
      scValArg(owner, "address"),
      scValArg(spender, "address"),
      scValArg(amount, "i128"),
      scValArg(expirationLedger, "u32"),
    ],
  );

  return submitPreparedTransaction(config, prepared, signer, owner);
}
