import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryReplayProtectionStore,
  replayProtectionManager,
} from '../replayProtection';

describe('Replay Protection', () => {
  describe('InMemoryReplayProtectionStore', () => {
    let store: InMemoryReplayProtectionStore;
    
    beforeEach(() => {
      store = new InMemoryReplayProtectionStore();
    });
    
    it('should mark events as processed', async () => {
      const eventId = 'evt_test_123';
      
      await store.markProcessed(eventId);
      const hasProcessed = await store.hasProcessed(eventId);
      
      expect(hasProcessed).toBe(true);
    });
    
    it('should return false for unprocessed events', async () => {
      const hasProcessed = await store.hasProcessed('evt_never_seen');
      
      expect(hasProcessed).toBe(false);
    });
    
    it('should respect TTL expiration', async () => {
      const eventId = 'evt_expires_123';
      
      // Mark with very short TTL (100ms)
      await store.markProcessed(eventId, 100);
      
      expect(await store.hasProcessed(eventId)).toBe(true);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(await store.hasProcessed(eventId)).toBe(false);
    });
    
    it('should cleanup expired events', async () => {
      await store.markProcessed('evt_1', 100);
      await store.markProcessed('evt_2', 100);
      await store.markProcessed('evt_3', 10000); // Long TTL
      
      expect(store.size()).toBe(3);
      
      // Wait for first two to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      await store.cleanup();
      
      expect(store.size()).toBe(1);
      expect(await store.hasProcessed('evt_3')).toBe(true);
    });
    
    it('should handle multiple events', async () => {
      const events = ['evt_1', 'evt_2', 'evt_3'];
      
      for (const eventId of events) {
        await store.markProcessed(eventId);
      }
      
      for (const eventId of events) {
        expect(await store.hasProcessed(eventId)).toBe(true);
      }
    });
    
    it('should allow clearing all events', () => {
      store.clear();
      expect(store.size()).toBe(0);
    });
  });
  
  describe('ReplayProtectionManager', () => {
    beforeEach(() => {
      // Use in-memory store for testing
      const testStore = new InMemoryReplayProtectionStore();
      replayProtectionManager.setStore(testStore);
      testStore.clear();
    });
    
    it('should detect first-time events', async () => {
      const eventId = 'evt_first_time';
      
      const isNew = await replayProtectionManager.checkAndMarkProcessed(eventId);
      
      expect(isNew).toBe(true);
    });
    
    it('should detect replay attempts', async () => {
      const eventId = 'evt_replay_test';
      
      // First attempt
      const firstAttempt = await replayProtectionManager.checkAndMarkProcessed(eventId);
      expect(firstAttempt).toBe(true);
      
      // Replay attempt
      const secondAttempt = await replayProtectionManager.checkAndMarkProcessed(eventId);
      expect(secondAttempt).toBe(false);
    });
    
    it('should check without marking', async () => {
      const eventId = 'evt_check_only';
      
      expect(await replayProtectionManager.hasProcessed(eventId)).toBe(false);
      
      await replayProtectionManager.checkAndMarkProcessed(eventId);
      
      expect(await replayProtectionManager.hasProcessed(eventId)).toBe(true);
    });
  });
  
  describe('Integration: Webhook Processing', () => {
    beforeEach(() => {
      const testStore = new InMemoryReplayProtectionStore();
      replayProtectionManager.setStore(testStore);
      testStore.clear();
    });
    
    it('should prevent duplicate webhook processing', async () => {
      const eventId = 'evt_webhook_123';
      const processedEvents: string[] = [];
      
      // Simulate webhook processing
      async function processWebhook(id: string): Promise<boolean> {
        const isNew = await replayProtectionManager.checkAndMarkProcessed(id);
        
        if (isNew) {
          processedEvents.push(id);
          return true;
        }
        
        return false;
      }
      
      // First delivery
      expect(await processWebhook(eventId)).toBe(true);
      expect(processedEvents).toHaveLength(1);
      
      // Duplicate delivery (replay attack)
      expect(await processWebhook(eventId)).toBe(false);
      expect(processedEvents).toHaveLength(1); // Not processed again
    });
  });
});
