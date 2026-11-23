/**
 * Issue 997: Conflict-Aware Offline Operation Queue
 * 
 * Queues work that survives refresh/disconnect, detects stale state conflicts,
 * and exposes deterministic retry or discard choices.
 */

interface QueuedOperation {
  id: string;
  type: 'purchase' | 'list_prompt' | 'update_price' | 'unlock_request';
  payload: Record<string, any>;
  stateSnapshot: Record<string, any>;
  timestamp: number;
  retryCount: number;
  status: 'pending' | 'processing' | 'conflict' | 'completed' | 'discarded';
  conflictReason?: string;
}

interface ConflictResolution {
  action: 'retry' | 'discard' | 'merge';
  mergedPayload?: Record<string, any>;
}

/**
 * Offline operation queue with conflict detection
 */
class OfflineOperationQueue {
  private readonly STORAGE_KEY = 'prompthash:offline_queue';
  private readonly MAX_RETRIES = 3;
  private queue: Map<string, QueuedOperation>;
  private listeners: Set<(queue: QueuedOperation[]) => void>;

  constructor() {
    this.queue = new Map();
    this.listeners = new Set();
    this.loadFromStorage();
    this.setupOnlineListener();
  }

  /**
   * Load queue from localStorage
   */
  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const operations: QueuedOperation[] = JSON.parse(stored);
        operations.forEach(op => this.queue.set(op.id, op));
      }
    } catch (error) {
      console.error('Failed to load offline queue:', error);
    }
  }

  /**
   * Persist queue to localStorage
   */
  private persistToStorage() {
    try {
      const operations = Array.from(this.queue.values());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(operations));
    } catch (error) {
      console.error('Failed to persist offline queue:', error);
    }
  }

  /**
   * Setup online/offline listeners
   */
  private setupOnlineListener() {
    window.addEventListener('online', () => {
      console.log('Back online - processing queued operations');
      this.processQueue();
    });

    // Process queue on page load if online
    if (navigator.onLine) {
      setTimeout(() => this.processQueue(), 1000);
    }
  }

  /**
   * Generate unique operation ID
   */
  private generateId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add operation to queue
   */
  enqueue(
    type: QueuedOperation['type'],
    payload: Record<string, any>,
    stateSnapshot: Record<string, any>
  ): string {
    const operation: QueuedOperation = {
      id: this.generateId(),
      type,
      payload,
      stateSnapshot,
      timestamp: Date.now(),
      retryCount: 0,
      status: 'pending'
    };

    this.queue.set(operation.id, operation);
    this.persistToStorage();
    this.notifyListeners();

    console.log(`Queued operation: ${type}`, operation);

    // Try to process immediately if online
    if (navigator.onLine) {
      this.processQueue();
    }

    return operation.id;
  }

  /**
   * Detect state conflicts
   */
  private async detectConflict(operation: QueuedOperation): Promise<string | null> {
    try {
      // Fetch current state from server
      const currentState = await this.fetchCurrentState(operation.type, operation.payload);

      // Compare with operation's state snapshot
      if (operation.type === 'update_price') {
        const snapshotPrice = operation.stateSnapshot.price;
        const currentPrice = currentState.price;

        if (snapshotPrice !== currentPrice) {
          return `Price changed from ${snapshotPrice} to ${currentPrice} XLM`;
        }
      }

      if (operation.type === 'purchase') {
        const snapshotStock = operation.stateSnapshot.availableStock;
        const currentStock = currentState.availableStock;

        if (currentStock === 0) {
          return 'Prompt sold out';
        }

        if (snapshotStock > currentStock) {
          return `Stock reduced from ${snapshotStock} to ${currentStock}`;
        }
      }

      if (operation.type === 'list_prompt') {
        const promptId = operation.payload.promptId;
        if (currentState.exists) {
          return `Prompt ${promptId} already listed`;
        }
      }

      return null;
    } catch (error) {
      console.error('Conflict detection failed:', error);
      return null; // Assume no conflict if check fails
    }
  }

  /**
   * Fetch current state from server
   */
  private async fetchCurrentState(
    type: QueuedOperation['type'],
    payload: Record<string, any>
  ): Promise<Record<string, any>> {
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

    switch (type) {
      case 'purchase':
      case 'update_price': {
        const promptId = payload.promptId;
        const response = await fetch(`${baseUrl}/api/prompts/${promptId}`);
        if (!response.ok) throw new Error('Failed to fetch prompt state');
        return await response.json();
      }

      case 'list_prompt': {
        const listResponse = await fetch(`${baseUrl}/api/prompts/${payload.promptId}`);
        return { exists: listResponse.ok };
      }

      default:
        return {};
    }
  }

  /**
   * Execute operation
   */
  private async executeOperation(operation: QueuedOperation): Promise<boolean> {
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

    try {
      let response: Response;

      switch (operation.type) {
        case 'purchase':
          response = await fetch(`${baseUrl}/api/purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operation.payload)
          });
          break;

        case 'list_prompt':
          response = await fetch(`${baseUrl}/api/prompts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operation.payload)
          });
          break;

        case 'update_price':
          response = await fetch(`${baseUrl}/api/prompts/${operation.payload.promptId}/price`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ price: operation.payload.price })
          });
          break;

        case 'unlock_request':
          response = await fetch(`${baseUrl}/api/unlock/${operation.payload.promptId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operation.payload)
          });
          break;

        default:
          throw new Error(`Unknown operation type: ${operation.type}`);
      }

      return response.ok;
    } catch (error) {
      console.error(`Operation execution failed:`, error);
      return false;
    }
  }

  /**
   * Process queued operations
   */
  async processQueue() {
    const pendingOps = Array.from(this.queue.values())
      .filter(op => op.status === 'pending' || op.status === 'conflict')
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const operation of pendingOps) {
      if (operation.retryCount >= this.MAX_RETRIES) {
        operation.status = 'discarded';
        console.warn(`Operation ${operation.id} discarded after ${this.MAX_RETRIES} retries`);
        continue;
      }

      // Update status
      operation.status = 'processing';
      this.notifyListeners();

      // Check for conflicts
      const conflictReason = await this.detectConflict(operation);

      if (conflictReason) {
        operation.status = 'conflict';
        operation.conflictReason = conflictReason;
        console.warn(`Conflict detected for operation ${operation.id}:`, conflictReason);
        this.notifyListeners();
        continue;
      }

      // Execute operation
      const success = await this.executeOperation(operation);

      if (success) {
        operation.status = 'completed';
        console.log(`Operation ${operation.id} completed successfully`);
      } else {
        operation.retryCount++;
        operation.status = 'pending';
        console.warn(`Operation ${operation.id} failed, retry ${operation.retryCount}/${this.MAX_RETRIES}`);
      }

      this.notifyListeners();
    }

    // Cleanup completed and discarded operations older than 24 hours
    this.cleanupOldOperations();
    this.persistToStorage();
  }

  /**
   * Cleanup old operations
   */
  private cleanupOldOperations() {
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    for (const [id, op] of this.queue.entries()) {
      if ((op.status === 'completed' || op.status === 'discarded') && op.timestamp < dayAgo) {
        this.queue.delete(id);
      }
    }
  }

  /**
   * Resolve conflict - user decision
   */
  resolveConflict(operationId: string, resolution: ConflictResolution) {
    const operation = this.queue.get(operationId);
    if (!operation || operation.status !== 'conflict') {
      console.error(`Operation ${operationId} not found or not in conflict state`);
      return;
    }

    switch (resolution.action) {
      case 'retry':
        operation.status = 'pending';
        operation.retryCount = 0; // Reset retry count on manual retry
        console.log(`Retrying operation ${operationId}`);
        this.processQueue();
        break;

      case 'discard':
        operation.status = 'discarded';
        console.log(`Discarded operation ${operationId}`);
        break;

      case 'merge':
        if (resolution.mergedPayload) {
          operation.payload = { ...operation.payload, ...resolution.mergedPayload };
          operation.status = 'pending';
          operation.retryCount = 0;
          console.log(`Merged and retrying operation ${operationId}`);
          this.processQueue();
        }
        break;
    }

    this.persistToStorage();
    this.notifyListeners();
  }

  /**
   * Get all operations
   */
  getOperations(): QueuedOperation[] {
    return Array.from(this.queue.values());
  }

  /**
   * Get operations by status
   */
  getOperationsByStatus(status: QueuedOperation['status']): QueuedOperation[] {
    return Array.from(this.queue.values()).filter(op => op.status === status);
  }

  /**
   * Subscribe to queue changes
   */
  subscribe(listener: (queue: QueuedOperation[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify listeners
   */
  private notifyListeners() {
    const operations = this.getOperations();
    this.listeners.forEach(listener => listener(operations));
  }

  /**
   * Clear completed operations
   */
  clearCompleted() {
    for (const [id, op] of this.queue.entries()) {
      if (op.status === 'completed') {
        this.queue.delete(id);
      }
    }
    this.persistToStorage();
    this.notifyListeners();
  }
}

/**
 * Singleton instance
 */
export const offlineQueue = new OfflineOperationQueue();

/**
 * React hook for using offline queue
 */
export function useOfflineQueue() {
  const [operations, setOperations] = React.useState<QueuedOperation[]>([]);

  React.useEffect(() => {
    setOperations(offlineQueue.getOperations());
    return offlineQueue.subscribe(setOperations);
  }, []);

  return {
    operations,
    enqueue: offlineQueue.enqueue.bind(offlineQueue),
    resolveConflict: offlineQueue.resolveConflict.bind(offlineQueue),
    clearCompleted: offlineQueue.clearCompleted.bind(offlineQueue),
    conflictingOps: operations.filter(op => op.status === 'conflict'),
    pendingOps: operations.filter(op => op.status === 'pending'),
    processingOps: operations.filter(op => op.status === 'processing')
  };
}

// React import for hook (will be available in React environment)
import * as React from 'react';
