/**
 * Telemetry Service with High-Cardinality Redaction and Deterministic Sampling (#1131)
 *
 * Capabilities:
 * 1. Deep recursive redaction of sensitive and high-cardinality fields:
 *    - Full Stellar public addresses (G...) -> masked (e.g. GBRP...OX2H)
 *    - Stellar secret keys (S...) -> [REDACTED]
 *    - Full 64-char transaction hashes -> masked
 *    - UUIDs and authorization tokens -> redacted/masked
 *    - Secrets, passwords, seeds, and bearer tokens -> [REDACTED]
 * 2. Deterministic, error-preserving sampling:
 *    - 'FAILURE' operations are ALWAYS 100% sampled (never dropped)
 *    - 'SUCCESS' operations use deterministic correlation-id sampling (rate 0.0 - 1.0)
 *    - Carries sampleRate and sampleWeight for statistical query reconstruction
 * 3. Bounded in-memory storage (FIFO ring-buffer) preventing memory leaks.
 */

export type ActorType = "CREATOR" | "BUYER" | "ADMIN" | "SYSTEM";
export type OperationResult = "SUCCESS" | "FAILURE";

export type CoreOperation =
  | "prompt-verification"
  | "wallet-connect"
  | "escrow-settlement"
  | "prompt-purchase"
  | "data-export";

export interface TelemetryEvent {
  operation: CoreOperation;
  actorType: ActorType;
  result: OperationResult;
  latencyMs: number;
  correlationId: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  sampled: boolean;
  sampleRate: number;
  sampleWeight: number;
}

export interface TelemetrySamplingConfig {
  defaultSuccessSampleRate?: number;
  operationSampleRates?: Partial<Record<CoreOperation, number>>;
  maxBufferSize?: number;
}

const STELLAR_PUBLIC_KEY_REGEX = /\b([GM][A-Z2-7]{55,68}|C[A-Z2-7]{55})\b/g;
const STELLAR_SECRET_KEY_REGEX = /\b(S[A-Z2-7]{55})\b/g;
const HEX_HASH_64_REGEX = /\b([a-fA-F0-9]{64})\b/g;
const UUID_REGEX = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

export class TelemetryService {
  private events: TelemetryEvent[] = [];
  private readonly defaultSuccessSampleRate: number;
  private readonly operationSampleRates: Partial<Record<CoreOperation, number>>;
  private readonly maxBufferSize: number;

  constructor(config: TelemetrySamplingConfig = {}) {
    this.defaultSuccessSampleRate = config.defaultSuccessSampleRate ?? 1.0;
    this.operationSampleRates = config.operationSampleRates ?? {};
    this.maxBufferSize = config.maxBufferSize ?? 5000;
  }

  /**
   * Deterministic hash from string into [0, 10000).
   * Ensures events with the same correlationId sample consistently.
   */
  private hashCorrelationId(correlationId: string): number {
    let hash = 0;
    for (let i = 0; i < correlationId.length; i++) {
      hash = (hash << 5) - hash + correlationId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 10000;
  }

  /**
   * Evaluates sampling decision.
   * Failures are strictly 100% sampled.
   */
  public evaluateSampling(
    operation: CoreOperation,
    result: OperationResult,
    correlationId: string
  ): { sampled: boolean; sampleRate: number; sampleWeight: number } {
    if (result === "FAILURE") {
      return { sampled: true, sampleRate: 1.0, sampleWeight: 1.0 };
    }

    const rate = this.operationSampleRates[operation] ?? this.defaultSuccessSampleRate;
    if (rate >= 1.0) {
      return { sampled: true, sampleRate: 1.0, sampleWeight: 1.0 };
    }
    if (rate <= 0.0) {
      return { sampled: false, sampleRate: 0.0, sampleWeight: 0.0 };
    }

    const bucket = this.hashCorrelationId(correlationId);
    const sampled = bucket < Math.round(rate * 10000);
    const sampleWeight = sampled ? Math.round((1.0 / rate) * 100) / 100 : 0.0;

    return { sampled, sampleRate: rate, sampleWeight };
  }

  /**
   * Deeply redacts sensitive keys and high-cardinality tokens.
   */
  public sanitizeValue(val: unknown, keyName?: string): unknown {
    if (val === null || val === undefined) return val;

    if (typeof val === "string") {
      // 1. Direct secret keyword match
      if (keyName) {
        const lowerKey = keyName.toLowerCase();
        const sensitiveKeywords = ["secret", "privatekey", "seed", "password", "token", "internalsecret"];
        if (sensitiveKeywords.some((s) => lowerKey.includes(s))) {
          return "[REDACTED]";
        }
      }

      // 2. Secret Stellar keys
      if (STELLAR_SECRET_KEY_REGEX.test(val)) {
        return "[REDACTED]";
      }

      let sanitized = val;

      // 3. Full 56-char Stellar Public Addresses -> mask high-cardinality middle
      sanitized = sanitized.replace(STELLAR_PUBLIC_KEY_REGEX, (match) => {
        return `${match.slice(0, 4)}...${match.slice(-4)}`;
      });

      // 4. Full 64-char hex transaction hashes -> mask
      sanitized = sanitized.replace(HEX_HASH_64_REGEX, (match) => {
        return `${match.slice(0, 6)}...${match.slice(-6)}`;
      });

      // 5. UUIDs -> mask
      sanitized = sanitized.replace(UUID_REGEX, "[UUID]");

      return sanitized;
    }

    if (Array.isArray(val)) {
      return val.map((item) => this.sanitizeValue(item));
    }

    if (typeof val === "object") {
      const sanitizedObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        sanitizedObj[k] = this.sanitizeValue(v, k);
      }
      return sanitizedObj;
    }

    return val;
  }

  public record(
    operation: CoreOperation,
    actorType: ActorType,
    result: OperationResult,
    startTimeMs: number,
    correlationId: string,
    metadata?: Record<string, unknown>
  ): TelemetryEvent {
    const latencyMs = Math.max(0, Date.now() - startTimeMs);
    const { sampled, sampleRate, sampleWeight } = this.evaluateSampling(
      operation,
      result,
      correlationId
    );

    const sanitizedMetadata = metadata
      ? (this.sanitizeValue(metadata) as Record<string, unknown>)
      : undefined;

    const event: TelemetryEvent = {
      operation,
      actorType,
      result,
      latencyMs,
      correlationId,
      timestamp: new Date().toISOString(),
      metadata: sanitizedMetadata,
      sampled,
      sampleRate,
      sampleWeight,
    };

    if (sampled) {
      if (this.events.length >= this.maxBufferSize) {
        this.events.shift(); // FIFO eviction for bounded memory
      }
      this.events.push(event);
      console.log(`[Telemetry] ${JSON.stringify(event)}`);
    }

    return event;
  }

  public getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  public clear(): void {
    this.events = [];
  }
}

export const globalTelemetry = new TelemetryService();
