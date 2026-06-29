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

export type WalletErrorCategory =
  | "user_rejected"
  | "simulation_failure"
  | "expired_auth"
  | "network_error"
  | "contract_error"
  | "insufficient_funds"
  | "unknown";

export interface MappedWalletError {
  category: WalletErrorCategory;
  userMessage: string;
  recoveryHint: string;
  retryable: boolean;
}

export function mapWalletError(error: unknown): MappedWalletError {
  const msg = extractErrorMessage(error).toLowerCase();

  if (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("user cancelled") ||
    msg.includes("user canceled") ||
    msg.includes("rejected by user") ||
    msg.includes("cancelled by user") ||
    msg.includes("declined")
  ) {
    return {
      category: "user_rejected",
      userMessage: "Signature request was declined in your wallet.",
      recoveryHint: "Click purchase again when you are ready to approve.",
      retryable: true,
    };
  }

  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("expired") ||
    msg.includes("transaction expired")
  ) {
    return {
      category: "expired_auth",
      userMessage: "Transaction authorization expired.",
      recoveryHint: "Please try the purchase again with a fresh transaction.",
      retryable: true,
    };
  }

  if (
    msg.includes("simulation") ||
    msg.includes("host invocation failed") ||
    msg.includes("contract error") ||
    msg.includes("contracterror") ||
    msg.includes("wasm trap") ||
    msg.includes("restore")
  ) {
    return {
      category: "simulation_failure",
      userMessage: "The smart contract simulation failed.",
      recoveryHint: "This may be a temporary issue. Please retry in a moment.",
      retryable: true,
    };
  }

  if (
    msg.includes("insufficient") ||
    msg.includes("underfunded") ||
    msg.includes("op_underfunded") ||
    msg.includes("not enough")
  ) {
    return {
      category: "insufficient_funds",
      userMessage: "Your wallet does not have enough XLM for this transaction.",
      recoveryHint: "Add funds to your wallet and try again.",
      retryable: true,
    };
  }

  if (
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("connection refused")
  ) {
    return {
      category: "network_error",
      userMessage: "Could not reach the Stellar network.",
      recoveryHint: "Check your internet connection and try again.",
      retryable: true,
    };
  }

  if (
    msg.includes("tx_failed") ||
    msg.includes("tx_bad_auth") ||
    msg.includes("op_no_trust") ||
    msg.includes("op_not_authorized")
  ) {
    return {
      category: "contract_error",
      userMessage: "The transaction was rejected by the Stellar network.",
      recoveryHint: "Verify the transaction details and try again.",
      retryable: true,
    };
  }

  return {
    category: "unknown",
    userMessage: msg || "An unexpected error occurred.",
    recoveryHint: "Please try again. If the problem persists, contact support.",
    retryable: true,
  };
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unknown error";
}

export interface StellarNetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  allowHttp?: boolean;
  simulationAccount?: string;
}

export interface WalletTransactionSigner {
  /* eslint-disable no-unused-vars */
  signTransaction: (
    _xdr: string,
    _opts: { address: string; networkPassphrase: string },
  ) => Promise<{ signedTxXdr: string }>;
  /* eslint-enable no-unused-vars */
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
