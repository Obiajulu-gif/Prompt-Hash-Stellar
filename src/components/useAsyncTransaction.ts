import { useState, useCallback, useRef } from "react";
import { useTransactionFeedback } from "./TransactionProvider";
import { classifyWalletError } from "@/lib/wallet/walletErrors";

interface StellarError {
  response?: {
    data?: {
      extras?: {
        result_codes?: {
          transaction?: string;
          operations?: string[];
        };
      };
    };
  };
  message?: string;
}

/**
 * Translates generic Stellar RPC/Horizon error codes into human-readable prompts.
 */
const translateStellarError = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) {
    return classifyWalletError(error).message;
  }

  const err = error as StellarError;
  const txCode = err.response?.data?.extras?.result_codes?.transaction;
  const opCodes = err.response?.data?.extras?.result_codes?.operations;

  if (txCode === "tx_bad_auth") return "Transaction signing failed. Please check your wallet is unlocked and try again.";
  if (txCode === "tx_insufficient_balance" || opCodes?.includes("op_underfunded")) {
    return "Insufficient XLM balance. Please add funds to your wallet and try again.";
  }
  if (opCodes?.includes("op_no_trust")) return "A required trustline is missing. Please add the asset to your wallet first.";
  if (opCodes?.includes("op_not_authorized")) return "Your account is not authorized for this operation. Check wallet permissions.";

  const classified = classifyWalletError(error);
  if (classified.code !== "UNKNOWN") {
    return classified.recoveryAction
      ? `${classified.message} ${classified.recoveryAction}`
      : classified.message;
  }

  return err.message || "Failed to submit transaction to the Stellar network.";
};

interface UseAsyncTransactionOptions<TData, TVariables> {
  onOptimistic?: (_variables: TVariables) => void;
  onSuccess?: (_data: TData, _variables: TVariables) => void;
  onError?: (_error: Error, _variables: TVariables) => void;
  onSettled?: (_variables: TVariables, _result?: TData, _error?: unknown) => void;
  pendingMessage?: string | ((_variables: TVariables) => string);
  successMessage?: string | ((_data: TData) => string);
  errorMessage?: string | ((_error: Error) => string);
}
 

export function useAsyncTransaction<TData, TVariables = void>(
   
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: UseAsyncTransactionOptions<TData, TVariables>
) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TData | null>(null);
  const { addTransaction, updateTransaction, removeTransaction } = useTransactionFeedback();

  // Use refs to stabilize the execute function, preventing infinite loops
  // when options or mutationFn are passed inline.
  const mutationFnRef = useRef(mutationFn);
  const optionsRef = useRef(options);
  mutationFnRef.current = mutationFn;
  optionsRef.current = options;

  const execute = useCallback(
    async (variables: TVariables) => {
      const txId = Date.now().toString();
      const currentOptions = optionsRef.current;
      let settledData: TData | undefined;
      let settledError: Error | undefined;
      
      setIsLoading(true);
      setError(null);
      
      // Fire Optimistic Update Hook
      currentOptions?.onOptimistic?.(variables);

      addTransaction({
        id: txId,
        status: "pending",
        message: typeof currentOptions?.pendingMessage === 'function'
          ? currentOptions.pendingMessage(variables)
          : currentOptions?.pendingMessage || "Processing transaction...",
      });

      try {
        const result = await mutationFnRef.current(variables);
        settledData = result;
        setData(result);
        
        const successMsg = typeof currentOptions?.successMessage === 'function' 
          ? currentOptions.successMessage(result) 
          : currentOptions?.successMessage || "Transaction successful!";
        
        updateTransaction(txId, { status: "success", message: successMsg });

        // Fire Query Invalidation Hook
        currentOptions?.onSuccess?.(result, variables);
        return result;
      } catch (err) {
        const translated = translateStellarError(err);
        const normalizedError = err instanceof Error ? err : new Error(translated);
        settledError = normalizedError;
        
        let friendlyMessage = translated;
        if (currentOptions?.errorMessage) {
          friendlyMessage = typeof currentOptions.errorMessage === 'function'
            ? currentOptions.errorMessage(normalizedError)
            : currentOptions.errorMessage;
        }
        
        setError(normalizedError);
        
        // Inject the retry payload and map to the exact variables used
        updateTransaction(txId, {
          status: "error",
          message: friendlyMessage,
          retryAction: () => {
            removeTransaction(txId);
            execute(variables);
          },
        });

        currentOptions?.onError?.(normalizedError, variables);
        throw normalizedError;
      } finally {
        setIsLoading(false);
        currentOptions?.onSettled?.(variables, settledData, settledError);
      }
    },
    [addTransaction, updateTransaction, removeTransaction]
  );

  return { execute, isLoading, error, data };
}