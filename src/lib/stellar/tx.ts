import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import {
  Api,
  Server,
  assembleTransaction,
} from "@stellar/stellar-sdk/rpc";

export interface StellarNetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  allowHttp?: boolean;
  simulationAccount?: string;
}

export interface WalletTransactionSigner {
  signTransaction: (
    xdr: string,
    opts: { address: string; networkPassphrase: string },
  ) => Promise<{ signedTxXdr: string }>;
}

export interface PreparedContractCall {
  preparedTransaction: ReturnType<typeof TransactionBuilder.fromXDR>;
  simulation: Api.SimulateTransactionSuccessResponse;
  server: Server;
}

export function getRpcServer(config: StellarNetworkConfig) {
  return new Server(config.rpcUrl, {
    allowHttp: config.allowHttp ?? new URL(config.rpcUrl).hostname === "localhost",
  });
}

export function scValArg(value: unknown, type?: string) {
  return type ? nativeToScVal(value, { type }) : nativeToScVal(value);
}

export function readSimulationResult(simulation: Api.SimulateTransactionSuccessResponse) {
  if (!simulation.result) {
    return undefined;
  }

  return scValToNative(simulation.result.retval);
}

export async function simulateContractCall(
  config: StellarNetworkConfig,
  source: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
) {
  const server = getRpcServer(config);
  const account = await server.getAccount(source);
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (Api.isSimulationError(simulation)) {
    throw new Error(simulation.error);
  }

  if (Api.isSimulationRestore(simulation)) {
    throw new Error("Contract call requires a state restore before it can be submitted.");
  }

  return {
    server,
    transaction,
    simulation,
  };
}

export async function prepareContractCall(
  config: StellarNetworkConfig,
  source: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<PreparedContractCall> {
  const { server, transaction, simulation } = await simulateContractCall(
    config,
    source,
    contractId,
    method,
    args,
  );

  const preparedTransaction = assembleTransaction(transaction, simulation).build();

  return {
    preparedTransaction,
    simulation,
    server,
  };
}

export async function readContract<TResult>(
  config: StellarNetworkConfig,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<TResult> {
  if (!config.simulationAccount) {
    throw new Error("PUBLIC_STELLAR_SIMULATION_ACCOUNT is required for contract reads.");
  }

  const { simulation } = await simulateContractCall(
    config,
    config.simulationAccount,
    contractId,
    method,
    args,
  );

  return readSimulationResult(simulation) as TResult;
}

export async function submitPreparedTransaction(
  config: StellarNetworkConfig,
  prepared: PreparedContractCall,
  signer: WalletTransactionSigner,
  source: string,
) {
  const signed = await signer.signTransaction(
    prepared.preparedTransaction.toXDR(),
    {
      address: source,
      networkPassphrase: config.networkPassphrase,
    },
  );

  const signedTransaction = TransactionBuilder.fromXDR(
    signed.signedTxXdr,
    config.networkPassphrase,
  );

  const response = await prepared.server.sendTransaction(signedTransaction);
  if (response.status === "TRY_AGAIN_LATER") {
    throw new Error("The Stellar RPC asked the client to retry later.");
  }

  if (response.status === "ERROR") {
    const details = response.errorResult?.toXDR("base64");
    throw new Error(
      details ? `Transaction submission failed: ${details}` : "Transaction submission failed.",
    );
  }

  const result = await prepared.server.pollTransaction(response.hash, {
    attempts: 20,
    sleepStrategy: () => 1_000,
  });

  if (result.status === Api.GetTransactionStatus.SUCCESS) {
    return result;
  }

  if (result.status === Api.GetTransactionStatus.FAILED) {
    throw new Error(`Transaction failed: ${result.resultXdr.toXDR("base64")}`);
  }

  throw new Error("Transaction was not found after submission.");
}
