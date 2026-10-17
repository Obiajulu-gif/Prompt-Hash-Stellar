import { createHash } from 'crypto';

export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DEAD_LETTER';

export interface JobOptions {
  maxAttempts?: number;
  backoffMs?: number;
  idempotencyKey?: string;
}

export interface Job<T = any> {
  id: string;
  name: string;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  backoffMs: number;
  idempotencyKey?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export type JobHandler<T = any> = (job: Job<T>) => Promise<void>;

export class JobQueue {
  private jobs = new Map<string, Job>();
  private handlers = new Map<string, JobHandler>();
  private processedIdempotencyKeys = new Set<string>();

  public registerHandler(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  public enqueue<T>(name: string, payload: T, options?: JobOptions): Job<T> {
    const idempotencyKey = options?.idempotencyKey || 
      createHash('sha256').update(name + JSON.stringify(payload)).digest('hex');

    for (const j of this.jobs.values()) {
      if (j.idempotencyKey === idempotencyKey && j.status !== 'FAILED' && j.status !== 'DEAD_LETTER') {
        return j as Job<T>;
      }
    }

    const id = `job_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
    const job: Job<T> = {
      id,
      name,
      payload,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      backoffMs: options?.backoffMs ?? 1000,
      idempotencyKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.jobs.set(id, job);
    return job;
  }

  public async processJob(id: string): Promise<Job> {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`Job "${id}" not found`);
    }

    if (job.status === 'COMPLETED' || job.status === 'DEAD_LETTER') {
      return job;
    }

    const handler = this.handlers.get(job.name);
    if (!handler) {
      job.status = 'FAILED';
      job.lastError = `No handler registered for job type "${job.name}"`;
      job.updatedAt = new Date().toISOString();
      return job;
    }

    job.status = 'PROCESSING';
    job.attempts += 1;
    job.updatedAt = new Date().toISOString();

    try {
      await handler(job);
      job.status = 'COMPLETED';
      job.updatedAt = new Date().toISOString();
      if (job.idempotencyKey) {
        this.processedIdempotencyKeys.add(job.idempotencyKey);
      }
    } catch (err: any) {
      job.lastError = err?.message || String(err);
      job.updatedAt = new Date().toISOString();

      if (job.attempts >= job.maxAttempts) {
        job.status = 'DEAD_LETTER';
      } else {
        job.status = 'FAILED';
      }
    }

    return job;
  }

  public getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  public getAllJobs(): Job[] {
    return Array.from(this.jobs.values());
  }
}
