import { describe, expect, it, vi } from "vitest";
import {
  runSyntheticJourney,
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
      const fetchMock = vi.fn()
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
      const keys = fetchMock.mock.calls.slice(2).map(
        ([, options]) => JSON.parse(options.body).idempotencyKey,
      );
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
      .mockResolvedValueOnce(json({ plaintext: "unauthorized content leak" }, 200));

    const result = await runSyntheticJourney(
      { ...config, mode: "authorization-probe" },
      { fetch: fetchMock, sleep: vi.fn() }
    );

    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("unlock");
    expect(result.steps[2].error).toBe("authorization_boundary_failed");
  });
});
