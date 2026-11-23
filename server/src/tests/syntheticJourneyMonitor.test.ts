import { describe, expect, it, vi } from "vitest";
import {
  createJourneyHealthTracker,
  runSyntheticJourney,
  startSyntheticMonitoring,
  type SyntheticAlertEvent,
  type SyntheticJourneyResult,
  type SyntheticMonitorConfig,
} from "../services/syntheticJourneyMonitor";

const config: SyntheticMonitorConfig = {
  baseUrl: "https://market.example",
  promptId: "42",
  buyerAddress: "GTESTBUYER",
  mode: "authorized",
  maxAttempts: 3,
  retryBaseMs: 1,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("synthetic critical journey (#1039)", () => {
  it("keeps unlock retries correlated without sharing keys across journeys", async () => {
    const run = async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json([{ onChainId: 42 }]))
        .mockResolvedValueOnce(json({ token: "token", challenge: "sign-me" }))
        .mockResolvedValueOnce(json({ code: "TEMPORARY_FAILURE" }, 503))
        .mockResolvedValueOnce(json({ plaintext: "fixture" }));
      const result = await runSyntheticJourney(config, {
        fetch: fetchMock,
        signChallenge: vi.fn().mockResolvedValue("signature"),
        sleep: vi.fn(),
        now: () => 42,
      });
      expect(result.success).toBe(true);
      const keys = fetchMock.mock.calls
        .slice(2)
        .map(([, options]) => JSON.parse(options.body).idempotencyKey);
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe(keys[1]);
      return keys[0];
    };
    const [first, second] = await Promise.all([run(), run()]);
    expect(first).not.toBe(second);
  });

  it("covers browse, challenge, and an authorized unlock", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{ onChainId: 42 }]))
      .mockResolvedValueOnce(json({ token: "token", challenge: "sign-me" }))
      .mockResolvedValueOnce(json({ plaintext: "never logged" }));
    const result = await runSyntheticJourney(config, {
      fetch: fetchMock,
      signChallenge: vi.fn().mockResolvedValue("valid-signature"),
      sleep: vi.fn(),
    });
    expect(result.success).toBe(true);
    expect(result.steps.map((step) => step.name)).toEqual([
      "browse",
      "challenge",
      "unlock",
    ]);
    expect(fetchMock.mock.calls[2][1].body).toContain(
      '"signedMessage":"valid-signature"',
    );
    expect(JSON.stringify(result)).not.toContain("plaintext");
    expect(JSON.stringify(result)).not.toContain("valid-signature");
  });

  it("treats the expected 401 stable code as a successful authorization probe", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{}]))
      .mockResolvedValueOnce(json({ token: "token", challenge: "sign-me" }))
      .mockResolvedValueOnce(
        json(
          { error: "Invalid wallet signature.", code: "INVALID_SIGNATURE" },
          401,
        ),
      );
    const result = await runSyntheticJourney(
      { ...config, mode: "authorization-probe" },
      {
        fetch: fetchMock,
        sleep: vi.fn(),
      },
    );
    expect(result.success).toBe(true);
    expect(result.steps[2]).toMatchObject({
      status: 401,
      code: "INVALID_SIGNATURE",
      attempts: 1,
    });
  });

  it("retries transient failures with backoff and then succeeds", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ code: "TEMPORARY_FAILURE" }, 503))
      .mockResolvedValueOnce(json([{ onChainId: 42 }]))
      .mockResolvedValueOnce(json({ token: "token", challenge: "sign-me" }))
      .mockResolvedValueOnce(json({ plaintext: "ok" }));
    const result = await runSyntheticJourney(config, {
      fetch: fetchMock,
      signChallenge: () => "signature",
      sleep,
    });
    expect(result.success).toBe(true);
    expect(result.steps[0].attempts).toBe(2);
    expect(sleep).toHaveBeenCalledWith(1);
  });

  it("does not retry authorization failures and stops the journey", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{}]))
      .mockResolvedValueOnce(json({ code: "UNAUTHORIZED" }, 403));
    const result = await runSyntheticJourney(config, {
      fetch: fetchMock,
      signChallenge: () => "signature",
      sleep: vi.fn(),
    });
    expect(result).toMatchObject({ success: false, failedStep: "challenge" });
    expect(result.steps[1]).toMatchObject({
      attempts: 1,
      status: 403,
      code: "UNAUTHORIZED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails with bounded attempts when a dependency remains unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ code: "TEMPORARY_FAILURE" }, 503));
    const result = await runSyntheticJourney(config, {
      fetch: fetchMock,
      signChallenge: () => "signature",
      sleep: vi.fn(),
    });
    expect(result).toMatchObject({ success: false, failedStep: "browse" });
    expect(result.steps[0]).toMatchObject({ attempts: 3, status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails fast with 400 when authorized mode is requested without signChallenge", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{ onChainId: 42 }]))
      .mockResolvedValueOnce(json({ token: "token", challenge: "sign-me" }));
    const result = await runSyntheticJourney(config, {
      fetch: fetchMock,
      // missing signChallenge
      sleep: vi.fn(),
    });
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("unlock");
    expect(result.steps[2]).toMatchObject({
      attempts: 1,
      status: 400,
      error: "authorized_signer_missing",
    });
  });

  it("detects authorization boundary failure if probe receives unexpected 200 OK", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{ onChainId: 42 }]))
      .mockResolvedValueOnce(json({ token: "token", challenge: "sign-me" }))
      .mockResolvedValueOnce(
        json({ plaintext: "unauthorized content leak" }, 200),
      );

    const result = await runSyntheticJourney(
      { ...config, mode: "authorization-probe" },
      { fetch: fetchMock, sleep: vi.fn() },
    );

    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("unlock");
    expect(result.steps[2].error).toBe("authorization_boundary_failed");
  });

  it("classifies a timed-out request and retries within the attempt bound", async () => {
    const timeout = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    const fetchMock = vi.fn().mockRejectedValue(timeout);
    const result = await runSyntheticJourney(
      { ...config, maxAttempts: 2 },
      { fetch: fetchMock, sleep: vi.fn(), signChallenge: () => "signature" },
    );
    expect(result).toMatchObject({ success: false, failedStep: "browse" });
    expect(result.steps[0]).toMatchObject({
      attempts: 2,
      error: "request_timeout",
    });
  });

  it("does not retry a non-JSON but successful browse response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html>maintenance</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const result = await runSyntheticJourney(
      { ...config, maxAttempts: 3 },
      { fetch: fetchMock, sleep: vi.fn(), signChallenge: () => "signature" },
    );
    expect(result).toMatchObject({ success: false, failedStep: "browse" });
    expect(result.steps[0]).toMatchObject({
      attempts: 1,
      status: 200,
      error: "synthetic_prompt_missing",
    });
  });

  it("fails once without requesting unlock when the local signer throws", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{ onChainId: 42 }]))
      .mockResolvedValueOnce(json({ token: "t", challenge: "c" }));
    const result = await runSyntheticJourney(config, {
      fetch: fetchMock,
      sleep: vi.fn(),
      signChallenge: () => {
        throw new Error("wallet unavailable");
      },
    });
    expect(result).toMatchObject({ success: false, failedStep: "unlock" });
    expect(result.steps[2]).toMatchObject({
      attempts: 1,
      error: "challenge_signing_failed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never serializes challenge tokens or signatures into the result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{ onChainId: 42 }]))
      .mockResolvedValueOnce(
        json({ token: "secret-token", challenge: "sign-me" }),
      )
      .mockResolvedValueOnce(json({ plaintext: "fixture" }));
    const result = await runSyntheticJourney(config, {
      fetch: fetchMock,
      sleep: vi.fn(),
      signChallenge: () => "secret-signature",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("sign-me");
    expect(serialized).not.toContain("secret-signature");
    expect(serialized).not.toContain("fixture");
  });
});

describe("synthetic journey alerting (#1154)", () => {
  const failedResult = (correlationId: string): SyntheticJourneyResult => ({
    timestamp: "2026-11-22T00:00:00.000Z",
    success: false,
    mode: "authorized",
    totalDurationMs: 5,
    correlationId,
    failedStep: "unlock",
    steps: [
      {
        name: "unlock",
        success: false,
        latencyMs: 5,
        attempts: 1,
        status: 503,
        code: "TEMPORARY_FAILURE",
      },
    ],
  });

  const healthyResult = (correlationId: string): SyntheticJourneyResult => ({
    timestamp: "2026-11-22T00:01:00.000Z",
    success: true,
    mode: "authorized",
    totalDurationMs: 4,
    correlationId,
    steps: [
      { name: "browse", success: true, latencyMs: 1, attempts: 1, status: 200 },
      {
        name: "challenge",
        success: true,
        latencyMs: 1,
        attempts: 1,
        status: 200,
      },
      { name: "unlock", success: true, latencyMs: 2, attempts: 1, status: 200 },
    ],
  });

  it("alerts once at the threshold and announces recovery once", () => {
    const tracker = createJourneyHealthTracker(2);
    expect(tracker.record(failedResult("a"))).toMatchObject({
      consecutiveFailures: 1,
      alerting: false,
    });
    const second = tracker.record(failedResult("b"));
    expect(second.alert).toMatchObject({
      event: "synthetic_journey_alert",
      consecutiveFailures: 2,
      failedStep: "unlock",
      status: 503,
      code: "TEMPORARY_FAILURE",
    });
    expect(tracker.record(failedResult("c")).alert).toBeUndefined();

    const recovery = tracker.record(healthyResult("d"));
    expect(recovery.recovered).toMatchObject({
      event: "synthetic_journey_recovered",
      consecutiveFailures: 3,
    });
    expect(tracker.snapshot()).toEqual({
      consecutiveFailures: 0,
      alerting: false,
    });
    expect(tracker.record(healthyResult("e")).recovered).toBeUndefined();
  });

  it("schedules runs, survives a transient failure, and stops cleanly", async () => {
    const alerts: SyntheticAlertEvent[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ code: "TEMPORARY_FAILURE" }, 503))
      .mockResolvedValueOnce(json({ code: "TEMPORARY_FAILURE" }, 503))
      .mockResolvedValueOnce(json([{ onChainId: 42 }]))
      .mockResolvedValueOnce(json({ token: "t", challenge: "c" }))
      .mockResolvedValueOnce(json({ plaintext: "ok" }));
    const monitor = startSyntheticMonitoring(
      { ...config, maxAttempts: 1 },
      { fetch: fetchMock, sleep: vi.fn(), signChallenge: () => "signature" },
      {
        intervalMs: 60_000,
        failureThreshold: 2,
        runImmediately: false,
        log: () => undefined,
        onAlert: (event) => alerts.push(event),
      },
    );

    expect((await monitor.runNow())?.success).toBe(false);
    expect(alerts).toHaveLength(0);
    expect((await monitor.runNow())?.success).toBe(false);
    expect(alerts.map((event) => event.event)).toEqual([
      "synthetic_journey_alert",
    ]);
    expect((await monitor.runNow())?.success).toBe(true);
    expect(alerts.map((event) => event.event)).toEqual([
      "synthetic_journey_alert",
      "synthetic_journey_recovered",
    ]);

    monitor.stop();
  });

  it("skips an overlapping run instead of stacking requests", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return json([{ onChainId: 42 }]);
    });
    const monitor = startSyntheticMonitoring(
      config,
      { fetch: fetchMock, sleep: vi.fn(), signChallenge: () => "signature" },
      { intervalMs: 60_000, runImmediately: false, log: () => undefined },
    );

    const first = monitor.runNow();
    const second = await monitor.runNow();
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release();
    await first;
    monitor.stop();
  });
});
