import { JobQueue } from './job-queue';
import { handlePromptVerification, PromptVerificationPayload } from './tasks/prompt-verification';

describe('JobQueue & Background Workers (#805)', () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue();
    queue.registerHandler('verify-prompt', handlePromptVerification);
  });

  it('successfully enqueues and processes a job', async () => {
    const payload: PromptVerificationPayload = {
      promptId: 'prompt-999',
      creatorAddress: 'GBX...CREATOR',
      stellarTxHash: 'tx-hash-abc',
    };

    const job = queue.enqueue('verify-prompt', payload);
    expect(job.status).toBe('PENDING');
    expect(job.attempts).toBe(0);

    const processed = await queue.processJob(job.id);
    expect(processed.status).toBe('COMPLETED');
    expect(processed.attempts).toBe(1);
  });

  it('retries failed jobs and eventually succeeds on retry', async () => {
    const payload: PromptVerificationPayload = {
      promptId: 'prompt-fail',
      creatorAddress: 'GBX...CREATOR',
      stellarTxHash: 'simulate-retry',
    };

    const job = queue.enqueue('verify-prompt', payload, { maxAttempts: 2 });
    
    let res = await queue.processJob(job.id);
    expect(res.status).toBe('FAILED');
    expect(res.attempts).toBe(1);

    res = await queue.processJob(job.id);
    expect(res.status).toBe('COMPLETED');
    expect(res.attempts).toBe(2);
  });

  it('moves job to DEAD_LETTER when maxAttempts is exceeded', async () => {
    queue.registerHandler('always-fail', async () => {
      throw new Error('Permanent failure');
    });

    const job = queue.enqueue('always-fail', { test: true }, { maxAttempts: 2 });

    await queue.processJob(job.id);
    const res = await queue.processJob(job.id);
    expect(res.status).toBe('DEAD_LETTER');
    expect(res.attempts).toBe(2);
  });

  it('ensures idempotency by preventing duplicate pending jobs', () => {
    const payload = { promptId: 'p-1', creatorAddress: 'G1', stellarTxHash: 'tx-1' };
    const job1 = queue.enqueue('verify-prompt', payload, { idempotencyKey: 'idem-key-1' });
    const job2 = queue.enqueue('verify-prompt', payload, { idempotencyKey: 'idem-key-1' });

    expect(job1.id).toBe(job2.id);
    expect(queue.getAllJobs().length).toBe(1);
  });
});
