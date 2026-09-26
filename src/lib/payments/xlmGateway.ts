import { TransactionBuilder } from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import {
  prepareContractCall,
  scValArg,
  type StellarNetworkConfig,
  type WalletTransactionSigner,
} from "@/lib/stellar/tx";

export type XlmPaymentStatus =
  | "awaiting_approval"
  | "submitting"
  | "pending"
  | "confirmed"
  | "failed";

export interface XlmPaymentStatusUpdate {
  status: XlmPaymentStatus;
  message: string;
  txHash?: string;
}

export interface XlmPromptPaymentRequest {
  config: StellarNetworkConfig & { promptHashContractId: string };
  signer: WalletTransactionSigner;
  buyerAddress: string;
  promptId: string | bigint | number;
  amountStroops: string | bigint | number;
  referrer?: string | null;
  onStatus?: (_update: XlmPaymentStatusUpdate) => void;
}

export interface XlmPromptPaymentResult {
  txHash: string;
  success: true;
  status: "confirmed";
}

const POLL_ATTEMPTS = 20;

function normalizePositiveBigInt(
  value: string | bigint | number,
  label: string,
): bigint {
  const normalized = BigInt(value);
  if (normalized <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return normalized;
}

function emit(
  onStatus: XlmPromptPaymentRequest["onStatus"],
  update: XlmPaymentStatusUpdate,
) {
  onStatus?.(update);
}

export function buildXlmPromptPaymentArgs(request: XlmPromptPaymentRequest) {
  const promptId = normalizePositiveBigInt(request.promptId, "promptId");
  const amount = normalizePositiveBigInt(
    request.amountStroops,
    "amountStroops",
  );

  return [
    scValArg(request.buyerAddress, "address"),
    scValArg(promptId, "u64"),
    request.referrer ? scValArg(request.referrer, "address") : scValArg(null),
    scValArg(amount, "i128"),
    scValArg(null),
  ];
}

export async function submitXlmPromptPayment(
  request: XlmPromptPaymentRequest,
): Promise<XlmPromptPaymentResult> {
  const args = buildXlmPromptPaymentArgs(request);

  emit(request.onStatus, {
    status: "awaiting_approval",
    message: "Review and approve the XLM payment in your wallet.",
  });

  const prepared = await prepareContractCall(
    request.config,
    request.buyerAddress,
    request.config.promptHashContractId,
    "buy_prompt",
    args,
  );

  const signed = await request.signer.signTransaction(
    prepared.preparedTransaction.toXDR(),
    {
      address: request.buyerAddress,
      networkPassphrase: request.config.networkPassphrase,
    },
  );

  emit(request.onStatus, {
    status: "submitting",
    message: "Submitting XLM payment to Stellar.",
  });

  const signedTransaction = TransactionBuilder.fromXDR(
    signed.signedTxXdr,
    request.config.networkPassphrase,
  );
  const submission = await prepared.server.sendTransaction(signedTransaction);

  if (submission.status === "TRY_AGAIN_LATER") {
    emit(request.onStatus, {
      status: "failed",
      message: "Stellar RPC asked the payment to retry later.",
    });
    throw new Error("The Stellar RPC asked the client to retry later.");
  }

  if (submission.status === "ERROR") {
    const details = submission.errorResult?.toXDR("base64");
    emit(request.onStatus, {
      status: "failed",
      message: "XLM payment submission failed.",
    });
    throw new Error(
      details
        ? `Transaction submission failed: ${details}`
        : "Transaction submission failed.",
    );
  }

  emit(request.onStatus, {
    status: "pending",
    message: "XLM payment submitted. Waiting for ledger confirmation.",
    txHash: submission.hash,
  });

  const result = await prepared.server.pollTransaction(submission.hash, {
    attempts: POLL_ATTEMPTS,
    sleepStrategy: () => 1_000,
  });

  if (result.status === Api.GetTransactionStatus.SUCCESS) {
    emit(request.onStatus, {
      status: "confirmed",
      message: "XLM payment confirmed. Unlocking your prompt.",
      txHash: submission.hash,
    });
    return {
      txHash: submission.hash,
      success: true,
      status: "confirmed",
    };
  }

  if (result.status === Api.GetTransactionStatus.FAILED) {
    emit(request.onStatus, {
      status: "failed",
      message: "XLM payment failed on Stellar.",
      txHash: submission.hash,
    });
    throw new Error(`Transaction failed: ${result.resultXdr.toXDR("base64")}`);
  }

  emit(request.onStatus, {
    status: "pending",
    message: "XLM payment is still pending confirmation.",
    txHash: submission.hash,
  });
  throw new Error("Transaction is still pending confirmation.");
}
