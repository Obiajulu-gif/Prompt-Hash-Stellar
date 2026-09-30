/**
 * Webhook Replay Protection
 * 
 * Prevents duplicate processing of webhook events using persistent event ID tracking.
 * Supports both in-memory (dev) and database-backed (production) storage.
 */

export interface ReplayProtectionStore {
  hasProcessed(eventId: string): Promise<boolean>;
  markProcessed(eventId: string, ttl?: number): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * In-memory replay protection store (for development/testing)
 */
export class InMemoryReplayProtectionStore implements ReplayProtectionStore {
  private processedEvents: Map<string, number> = new Map();
  private readonly defaultTTL: number = 86400000; // 24 hours in ms
  
  async hasProcessed(eventId: string): Promise<boolean> {
    const expiresAt = this.processedEvents.get(eventId);
    
    if (!expiresAt) {
      return false;
    }
    
    // Check if expired
    if (Date.now() > expiresAt) {
      this.processedEvents.delete(eventId);
      return false;
    }
    
    return true;
  }
  
  async markProcessed(eventId: string, ttl: number = this.defaultTTL): Promise<void> {
    const expiresAt = Date.now() + ttl;
    this.processedEvents.set(eventId, expiresAt);
  }
  
  async cleanup(): Promise<void> {
    const now = Date.now();
    
    for (const [eventId, expiresAt] of this.processedEvents.entries()) {
      if (now > expiresAt) {
        this.processedEvents.delete(eventId);
      }
    }
  }
  
  size(): number {
    return this.processedEvents.size;
  }
  
  clear(): void {
    this.processedEvents.clear();
  }
}

/**
 * Database-backed replay protection store (for production)
 */
export class DatabaseReplayProtectionStore implements ReplayProtectionStore {
  constructor(private model: any) {} // Mongoose model
  
  async hasProcessed(eventId: string): Promise<boolean> {
    const record = await this.model.findOne({ eventId, expiresAt: { $gt: new Date() } });
    return record !== null;
  }
  
  async markProcessed(eventId: string, ttl: number = 86400000): Promise<void> {
    const expiresAt = new Date(Date.now() + ttl);
    
    await this.model.create({
      eventId,
      processedAt: new Date(),
      expiresAt,
    });
  }
  
  async cleanup(): Promise<void> {
    // Remove expired records
    await this.model.deleteMany({ expiresAt: { $lt: new Date() } });
  }
}

/**
 * Global replay protection manager
 */
class ReplayProtectionManager {
  private store: ReplayProtectionStore;
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    // Default to in-memory store
    this.store = new InMemoryReplayProtectionStore();
    
    // Start periodic cleanup (every hour)
    this.startCleanup();
  }
  
  setStore(store: ReplayProtectionStore): void {
    this.store = store;
  }
  
  async checkAndMarkProcessed(eventId: string, ttl?: number): Promise<boolean> {
    const alreadyProcessed = await this.store.hasProcessed(eventId);
    
    if (alreadyProcessed) {
      return false; // Replay detected
    }
    
    await this.store.markProcessed(eventId, ttl);
    return true; // First time seeing this event
  }
  
  async hasProcessed(eventId: string): Promise<boolean> {
    return this.store.hasProcessed(eventId);
  }
  
  private startCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }
    
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.store.cleanup();
      } catch (error) {
        console.error('Replay protection cleanup failed:', error);
      }
    }, 3600000); // Every hour
    
    // Don't keep the process alive for cleanup
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }
  
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Global singleton instance
export const replayProtectionManager = new ReplayProtectionManager();

/**
 * Check if webhook event is a replay
 */
export async function isReplayAttack(eventId: string): Promise<boolean> {
  return replayProtectionManager.hasProcessed(eventId);
}

/**
 * Mark webhook event as processed
 */
export async function markEventProcessed(eventId: string, ttl?: number): Promise<void> {
  const isNew = await replayProtectionManager.checkAndMarkProcessed(eventId, ttl);
  
  if (!isNew) {
    throw new Error(`Event ${eventId} has already been processed (replay detected)`);
  }
}
