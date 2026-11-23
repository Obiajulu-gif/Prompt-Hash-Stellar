import { describe, expect, it } from "vitest";
import {
  InMemoryWebhookReplayStore,
  loadWebhookReplayFixture,
  replayWebhookFixture,
} from "../services/localWebhookReplay";

describe("local webhook replay fixtures", () => {
  it("loads each supported fixture and rejects arbitrary names", async () => {
    for (const name of ["success", "duplicate", "stale", "invalid-signature", "malformed"]) {
      await expect(loadWebhookReplayFixture(name)).resolves.toMatchObject({
        eventId: expect.any(String),
        rawBody: expect.any(String),
      });
    }
    await expect(loadWebhookReplayFixture("../../.env")).rejects.toThrow("Unknown fixture");
  });

  it("accepts a valid signed delivery and records one local side effect", async () => {
    const result = await replayWebhookFixture("success");

    expect(result).toEqual([
      expect.objectContaining({ status: "processed", alreadyProcessed: false, sideEffectCount: 1 }),
    ]);
  });

  it("treats a repeated event as a duplicate without repeating side effects", async () => {
    const result = await replayWebhookFixture("duplicate");

    expect(result.map(({ status }) => status)).toEqual(["processed", "duplicate"]);
    expect(result[1]).toMatchObject({ alreadyProcessed: true, sideEffectCount: 1 });
  });

  it("rejects a correctly signed event outside the five-minute window", async () => {
    const result = await replayWebhookFixture("stale");

    expect(result[0]).toMatchObject({ status: "stale", sideEffectCount: 0 });
  });

  it("rejects an invalid signature without a side effect", async () => {
    const result = await replayWebhookFixture("invalid-signature");

    expect(result[0]).toMatchObject({ status: "invalid_signature", sideEffectCount: 0 });
  });

  it("does not run side effects for a malformed but validly signed body", async () => {
    const result = await replayWebhookFixture("malformed");

    expect(result[0]).toMatchObject({ status: "malformed", sideEffectCount: 0 });
  });

  it("shares idempotency state across separate fixture invocations", async () => {
    const store = new InMemoryWebhookReplayStore();
    const [first] = await replayWebhookFixture("success", store);
    const [second] = await replayWebhookFixture("success", store);

    expect(first.status).toBe("processed");
    expect(second).toMatchObject({ status: "duplicate", sideEffectCount: 1 });
  });
});