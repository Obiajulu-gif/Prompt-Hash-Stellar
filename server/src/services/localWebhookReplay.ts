/**
 * Offline inbound-webhook replay harness for contributor debugging.
 *
 * This intentionally uses an in-memory idempotency store and a local-only
 * side-effect recorder. It never connects to MongoDB or invokes marketplace
 * business handlers. Signature verification is shared with the production
 * inbound processor so the canonical HMAC contract stays aligned.
 */

import { createHmac } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { verifyInboundSignature } from "./inboundWebhookProcessor";

const FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/webhook-replay");
const SIMULATED_NOW = Date.parse("2025-01-01T00:00:00.000Z");
const LOCAL_FIXTURE_SECRET = "local-webhook-replay-secret-not-for-production";
const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;
const FIXTURE_NAMES = ["success", "duplicate", "stale", "invalid-signature", "malformed"] as const;

export type WebhookReplayFixtureName = (typeof FIXTURE_NAMES)[number];
export type WebhookReplayStatus = "processed" | "duplicate" | "stale" | "invalid_signature" | "malformed";

interface FixtureFile {
  eventId: string;
  deliveryId: string;
  eventType: string;
  timestampOffsetSeconds: number;
  rawBody: string;
  signature: "valid" | "invalid";
  deliveries?: number;
}

export interface WebhookReplayResult {
  eventId: string;
  status: WebhookReplayStatus;
  alreadyProcessed: boolean;
  sideEffectCount: number;
}

export class InMemoryWebhookReplayStore {
  private readonly events = new Map<string, WebhookReplayStatus>();
  private readonly sideEffects = new Set<string>();

  has(eventId: string): boolean {
    return this.events.has(eventId);
  }

  record(eventId: string, status: WebhookReplayStatus): void {
    this.events.set(eventId, status);
  }

  recordLocalSideEffect(eventId: string): void {
    this.sideEffects.add(eventId);
  }

  sideEffectCount(): number {
    return this.sideEffects.size;
  }
}

/** Load a named, repository-owned fixture. Arbitrary paths are never accepted. */
export async function loadWebhookReplayFixture(
  name: string,
  fixtureDir = FIXTURE_DIR,
): Promise<FixtureFile> {
  if (!(FIXTURE_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unknown fixture "${name}". Choose: ${FIXTURE_NAMES.join(", ")}.`);
  }

  const content = await readFile(path.join(fixtureDir, `${name}.json`), "utf8");
  const fixture: unknown = JSON.parse(content);
  if (!isFixture(fixture)) {
    throw new Error(`Fixture "${name}" has an invalid structure.`);
  }
  return fixture;
}

/** Run one fixture through the production signature check and local-only gate. */
export async function replayWebhookFixture(
  name: string,
  store = new InMemoryWebhookReplayStore(),
): Promise<WebhookReplayResult[]> {
  const fixture = await loadWebhookReplayFixture(name);
  const timestamp = new Date(
    SIMULATED_NOW + fixture.timestampOffsetSeconds * 1000,
  ).toISOString();
  const signature = createFixtureSignature(fixture, timestamp);
  const deliveries = fixture.deliveries ?? 1;
  const results: WebhookReplayResult[] = [];

  for (let index = 0; index < deliveries; index += 1) {
    if (store.has(fixture.eventId)) {
      results.push({
        eventId: fixture.eventId,
        status: "duplicate",
        alreadyProcessed: true,
        sideEffectCount: store.sideEffectCount(),
      });
      continue;
    }

    // Match the production flow's persist-before-verify idempotency gate.
    store.record(fixture.eventId, "invalid_signature");
    const validSignature = verifyInboundSignature(
      LOCAL_FIXTURE_SECRET,
      {
        rawBody: fixture.rawBody,
        timestamp,
        eventId: fixture.eventId,
        deliveryId: fixture.deliveryId,
        now: SIMULATED_NOW,
        replayWindowMs: MAX_TIMESTAMP_AGE_MS,
      },
      signature,
    );

    if (!validSignature) {
      const status = fixture.timestampOffsetSeconds < -300 ? "stale" : "invalid_signature";
      store.record(fixture.eventId, status);
      results.push({ eventId: fixture.eventId, status, alreadyProcessed: false, sideEffectCount: store.sideEffectCount() });
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(fixture.rawBody);
    } catch {
      store.record(fixture.eventId, "malformed");
      results.push({ eventId: fixture.eventId, status: "malformed", alreadyProcessed: false, sideEffectCount: store.sideEffectCount() });
      continue;
    }

    // The real business handlers are deliberately not invoked. This recorder
    // represents one accepted local effect and proves a replay cannot repeat it.
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      store.recordLocalSideEffect(fixture.eventId);
    }
    store.record(fixture.eventId, "processed");
    results.push({ eventId: fixture.eventId, status: "processed", alreadyProcessed: false, sideEffectCount: store.sideEffectCount() });
  }

  return results;
}

function createFixtureSignature(fixture: FixtureFile, timestamp: string): string {
  const canonical = [timestamp, fixture.eventId, fixture.deliveryId, fixture.rawBody].join(".");
  const digest = createHmac("sha256", LOCAL_FIXTURE_SECRET).update(canonical).digest("hex");
  return fixture.signature === "valid" ? `sha256=${digest}` : `sha256=${"0".repeat(64)}`;
}

function isFixture(value: unknown): value is FixtureFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fixture = value as Partial<FixtureFile>;
  return (
    typeof fixture.eventId === "string" && fixture.eventId.length > 0 &&
    typeof fixture.deliveryId === "string" && fixture.deliveryId.length > 0 &&
    typeof fixture.eventType === "string" && fixture.eventType.length > 0 &&
    Number.isSafeInteger(fixture.timestampOffsetSeconds) &&
    typeof fixture.rawBody === "string" &&
    (fixture.signature === "valid" || fixture.signature === "invalid") &&
    (fixture.deliveries === undefined || (Number.isSafeInteger(fixture.deliveries) && fixture.deliveries > 0 && fixture.deliveries <= 10))
  );
}
