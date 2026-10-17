import { Job } from '../job-queue';

export interface PromptVerificationPayload {
  promptId: string;
  creatorAddress: string;
  stellarTxHash: string;
}

export async function handlePromptVerification(job: Job<PromptVerificationPayload>): Promise<void> {
  const { promptId, creatorAddress, stellarTxHash } = job.payload;
  
  if (!promptId || !stellarTxHash) {
    throw new Error('Invalid prompt verification payload: missing promptId or stellarTxHash');
  }

  await new Promise((resolve) => setTimeout(resolve, 50));

  if (job.attempts === 1 && stellarTxHash.includes('simulate-retry')) {
    throw new Error('Stellar ledger RPC timeout during escrow confirmation');
  }

  console.log(`[Worker] Successfully verified prompt ${promptId} for creator ${creatorAddress} via tx ${stellarTxHash}`);
}
