// hooks/useSubmitContractTx.ts
import { useMutation } from '@tanstack/react-query';
import { Server } from '@stellar/stellar-sdk/rpc';
import { TransactionBuilder } from '@stellar/stellar-sdk';

export const useSubmitContractTx = () => {
  return useMutation({
    mutationFn: async ({
      signedTxXdr,
      rpcUrl,
    }: {
      signedTxXdr: string;
      rpcUrl: string;
    }) => {
      const server = new Server(rpcUrl, { allowHttp: true });
      const tx = TransactionBuilder.fromXDR(signedTxXdr, "Test SDF Network ; September 2015");
      
      const sendResponse = await server.sendTransaction(tx);
      
      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction submission failed");
      }

      // Poll for result
      await new Promise(resolve => setTimeout(resolve, 2000));
      const result = await server.getTransaction(sendResponse.hash);
      
      if (result.status !== "SUCCESS") {
        throw new Error(`Transaction failed: ${result.status}`);
      }
      
      return result;
    },
  });
};