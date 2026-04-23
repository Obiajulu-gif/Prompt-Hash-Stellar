import { useState, useCallback, useRef } from "react";
import { useTransactionFeedback } from "./TransactionProvider";

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
  if (typeof error !== 'object' || error === null) return "An unknown error occurred while submitting.";
  
  const err = error as StellarError;
  const txCode = err.response?.data?.extras?.result_codes?.transaction;
  const opCodes = err.response?.data?.extras?.result_codes?.operations;

  if (txCode === "tx_bad_auth") return "Transaction signing failed. Please check your wallet.";
  if (txCode === "tx_insufficient_balance" || opCodes?.includes("op_underfunded")) {
    return "Insufficient balance to cover transaction limits or fees.";
  }
  if (opCodes?.includes("op_no_trust")) return "A required trustline is missing for this transaction.";
  if (opCodes?.includes("op_not_authorized")) return "Your account is not authorized to perform this operation.";
  
  return err.message || "Failed to submit transaction to the Stellar network.";
};

interface UseAsyncTransactionOptions<TData, TVariables> {
  onOptimistic?: (variables: TVariables) => void;
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: Error, variables: TVariables) => void;
  onSettled?: () => void;
  pendingMessage?: string | ((variables: TVariables) => string);
  successMessage?: string | ((data: TData) => string);
  errorMessage?: string | ((error: Error) => string);
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
        currentOptions?.onSettled?.();
      }
    },
    [addTransaction, updateTransaction, removeTransaction]
  );

  return { execute, isLoading, error, data };
}