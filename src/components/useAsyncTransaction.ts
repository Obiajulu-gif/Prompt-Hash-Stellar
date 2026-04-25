import { useState, useCallback, useRef, useEffect } from "react";
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
  onSettled?: (variables: TVariables, result?: TData, error?: unknown) => void;
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

  const mutationFnRef = useRef(mutationFn);
  const optionsRef = useRef(options);
  mutationFnRef.current = mutationFn;
  optionsRef.current = options;

  const mountedRef = useRef(true);
  const activeTxIdRef = useRef<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (activeTxIdRef.current && removeTransaction) {
        removeTransaction(activeTxIdRef.current);
      }
    };
  }, [removeTransaction]);

  const execute = useCallback(
    async (variables: TVariables) => {
      const txId = crypto.randomUUID();
      activeTxIdRef.current = txId;
      
      /**
       * JSDoc Note:
       * optionsRef and mutationFnRef capture live values on every render.
       * The retryAction uses these latest closures to ensure retries use
       * current component state, rather than a stale failure-time snapshot.
       */
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
        if (!mountedRef.current) return result;

        settledData = result;
        setData(result);
        
        const successMsg = typeof currentOptions?.successMessage === 'function' 
          ? currentOptions.successMessage(result) 
          : currentOptions?.successMessage || "Transaction successful!";
        
        updateTransaction(txId, { status: "success", message: successMsg });

        if (removeTransaction) {
          timerRef.current = setTimeout(() => {
            if (mountedRef.current) removeTransaction(txId);
          }, 3000);
        }
        
        activeTxIdRef.current = null;

        // Fire Query Invalidation Hook
        currentOptions?.onSuccess?.(result, variables);
        return result;
      } catch (err) {
        if (!mountedRef.current) throw err;

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
        if (mountedRef.current) {
          setIsLoading(false);
          currentOptions?.onSettled?.(variables, settledData, settledError);
        }
      }
    },
    [addTransaction, updateTransaction, removeTransaction]
  );

  return { execute, isLoading, error, data };
}