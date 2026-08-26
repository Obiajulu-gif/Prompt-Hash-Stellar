/**
 * IPFS Gateway Failover with Circuit Breaker & Integrity Verification
 *
 * Supports multiple gateways with health tracking, automatic failover,
 * and CID/ciphertext integrity verification before decryption.
 */

import { sha256 } from "js-sha256";

export interface GatewayConfig {
  url: string;
  timeout: number; // milliseconds
  maxResponseSize: number; // bytes
}

export interface GatewayHealth {
  url: string;
  successCount: number;
  failureCount: number;
  lastError?: string;
  lastErrorTime?: number;
  isCircuitOpen: boolean;
  circuitOpenedAt?: number;
}

export interface IntegrityCheckResult {
  valid: boolean;
  cidHash?: string;
  contractHash?: string;
  error?: string;
}

export interface GatewayResponse {
  content: Uint8Array;
  gateway: string;
  cidHash: string;
}

export class IPFSGatewayPool {
  private gateways: GatewayConfig[];
  private health: Map<string, GatewayHealth> = new Map();
  private circuitBreakerThreshold = 5; // failures before opening circuit
  private circuitBreakerCooldown = 60_000; // 1 minute in ms
  private gatewayTimeout = 10_000; // 10 seconds
  private maxResponseSize = 50 * 1024 * 1024; // 50 MB

  constructor(gatewayUrls: string[]) {
    this.gateways = gatewayUrls.map((url) => ({
      url,
      timeout: this.gatewayTimeout,
      maxResponseSize: this.maxResponseSize,
    }));

    // Initialize health tracking
    for (const gateway of this.gateways) {
      this.health.set(gateway.url, {
        url: gateway.url,
        successCount: 0,
        failureCount: 0,
        isCircuitOpen: false,
      });
    }
  }

  /**
   * Fetch CID from first available healthy gateway
   * Verifies integrity against contract-committed hash
   */
  async fetchWithFailover(
    cid: string,
    expectedCidHash?: string,
  ): Promise<GatewayResponse> {
    const errors: Array<{ gateway: string; error: string }> = [];

    for (const gateway of this.gateways) {
      const health = this.health.get(gateway.url)!;

      // Skip if circuit is open
      if (this.isCircuitOpen(health)) {
        continue;
      }

      try {
        const content = await this.fetchFromGateway(cid, gateway);

        // Verify integrity
        const cidHash = this.computeCIDHash(content);
        if (expectedCidHash && cidHash !== expectedCidHash) {
          this.recordFailure(gateway.url, "CID hash mismatch");
          errors.push({
            gateway: gateway.url,
            error: `CID hash mismatch: expected ${expectedCidHash}, got ${cidHash}`,
          });
          continue;
        }

        // Success
        this.recordSuccess(gateway.url);
        return {
          content,
          gateway: gateway.url,
          cidHash,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.recordFailure(gateway.url, message);
        errors.push({
          gateway: gateway.url,
          error: message,
        });
      }
    }

    // All gateways failed
    const errorSummary = errors
      .map((e) => `${e.gateway}: ${e.error}`)
      .join("; ");
    throw new Error(`All IPFS gateways failed. Errors: ${errorSummary}`);
  }

  /**
   * Fetch from single gateway with timeout and size limits
   */
  private async fetchFromGateway(
    cid: string,
    config: GatewayConfig,
  ): Promise<Uint8Array> {
    const url = this.buildGatewayUrl(config.url, cid);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "error",
        headers: {
          "User-Agent": "PromptHash-IPFS-Client/1.0",
          "Accept-Encoding": "identity",
        },
      });

      if (!response.ok) {
        throw new Error(`Gateway returned ${response.status}`);
      }

      // Validate content type
      const contentType = response.headers.get("content-type") || "";
      const contentEncoding = response.headers.get("content-encoding") || "";
      if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
        throw new Error(`Compressed gateway responses are not accepted: ${contentEncoding}`);
      }
      if (
        contentType.includes("text/html") ||
        contentType.includes("application/json")
      ) {
        throw new Error(`Invalid content type: ${contentType}`);
      }

      // Check content length before downloading
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > config.maxResponseSize) {
          throw new Error(
            `Response too large: ${size} > ${config.maxResponseSize}`,
          );
        }
      }

      // Read response with size limit
      const buffer = await this.readWithSizeLimit(
        response,
        config.maxResponseSize,
      );

      return buffer;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Gateway timeout after ${config.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Read response body with enforced size limit
   */
  private async readWithSizeLimit(
    response: Response,
    maxSize: number,
  ): Promise<Uint8Array> {
    if (!response.body) {
      throw new Error("Response has no body");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > maxSize) {
          throw new Error(
            `Response exceeds size limit: ${totalSize} > ${maxSize}`,
          );
        }

        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Concatenate chunks
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /**
   * Compute SHA256 hash of content (CID verification)
   */
  private computeCIDHash(content: Uint8Array): string {
    const hashArray = sha256.array(content);
    return (
      "0x" +
      Array.from(hashArray)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
  }

  /**
   * Build full IPFS gateway URL
   */
  private buildGatewayUrl(baseUrl: string, cid: string): string {
    const cleanBase = baseUrl.replace(/\/$/, "");
    return `${cleanBase}/ipfs/${cid}`;
  }

  /**
   * Check if gateway circuit is open (in cooldown)
   */
  private isCircuitOpen(health: GatewayHealth): boolean {
    if (!health.isCircuitOpen) {
      return false;
    }

    const now = Date.now();
    const openedAt = health.circuitOpenedAt || 0;
    if (now - openedAt > this.circuitBreakerCooldown) {
      // Circuit cooldown expired, try again
      health.isCircuitOpen = false;
      health.failureCount = 0;
      return false;
    }

    return true;
  }

  /**
   * Record successful fetch
   */
  private recordSuccess(gatewayUrl: string): void {
    const health = this.health.get(gatewayUrl);
    if (!health) return;

    health.successCount += 1;
    health.failureCount = 0; // Reset failure counter
    health.lastError = undefined;
  }

  /**
   * Record failed fetch
   */
  private recordFailure(gatewayUrl: string, error: string): void {
    const health = this.health.get(gatewayUrl);
    if (!health) return;

    health.failureCount += 1;
    health.lastError = error;
    health.lastErrorTime = Date.now();

    // Open circuit if threshold exceeded
    if (health.failureCount >= this.circuitBreakerThreshold) {
      health.isCircuitOpen = true;
      health.circuitOpenedAt = Date.now();
    }
  }

  /**
   * Get current health status of all gateways
   */
  getHealth(): GatewayHealth[] {
    return Array.from(this.health.values());
  }

  /**
   * Get success rate for a gateway (0.0 - 1.0)
   */
  getSuccessRate(gatewayUrl: string): number {
    const health = this.health.get(gatewayUrl);
    if (!health) return 0;

    const total = health.successCount + health.failureCount;
    if (total === 0) return 1.0; // No data, assume healthy

    return health.successCount / total;
  }

  /**
   * Reset health tracking for testing
   */
  resetHealth(): void {
    for (const health of this.health.values()) {
      health.successCount = 0;
      health.failureCount = 0;
      health.isCircuitOpen = false;
      health.lastError = undefined;
    }
  }
}

/**
 * Global IPFS gateway pool instance
 */
let globalPool: IPFSGatewayPool | null = null;

export function initializeGatewayPool(gatewayUrls: string[]): IPFSGatewayPool {
  globalPool = new IPFSGatewayPool(gatewayUrls);
  return globalPool;
}

export function getGatewayPool(): IPFSGatewayPool {
  if (!globalPool) {
    // Default fallback gateways
    globalPool = new IPFSGatewayPool([
      "https://ipfs.io",
      "https://gateway.pinata.cloud",
      "https://cloudflare-ipfs.com",
    ]);
  }
  return globalPool;
}
