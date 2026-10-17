import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

vi.mock("../services/auditTrail", () => ({ recordAuditEvent: vi.fn() }));

import { abuseRiskGuard } from "../middleware/abuseRiskGuard.js";
import { abuseActivityLedger, abuseReviewQueue } from "../services/abuseRiskScoring.js";

const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function mockRes() {
  const res = new EventEmitter() as any;
  res.statusCode = 200;
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = vi.fn(() => res);
  return res;
}

function mockReq() {
  return { headers: {}, socket: { remoteAddress: "9.9.9.9" }, body: { wallet: WALLET } } as any;
}

function heat() {
  for (let i = 0; i < 25; i++) {
    abuseActivityLedger.record(
      { operation: "payout_request", wallet: WALLET, ip: `2.2.2.${i}`, target: "t" },
      false,
    );
  }
}

const make = (mode: "off" | "shadow" | "enforce", stepUp = false, amount = 900) =>
  abuseRiskGuard({
    operation: "payout_request",
    extract: (req) => ({ wallet: req.body.wallet, target: "t", amount }),
    mode: () => mode,
    stepUpSatisfied: () => stepUp,
  });

describe("abuseRiskGuard middleware", () => {
  beforeEach(() => {
    abuseActivityLedger.reset();
    abuseReviewQueue.clear();
  });

  it("passes ordinary requests straight through", () => {
    const next = vi.fn();
    make("enforce")(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("is a no-op when mode is off", () => {
    heat();
    const next = vi.fn();
    make("off")(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(abuseReviewQueue.list()).toHaveLength(0);
  });

  it("lets risky traffic through in shadow mode but still queues it", () => {
    heat();
    const next = vi.fn();
    make("shadow")(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(abuseReviewQueue.list("pending")).toHaveLength(1);
  });

  it("holds risky traffic for review in enforce mode with explanations", () => {
    heat();
    const next = vi.fn();
    const res = mockRes();
    make("enforce")(mockReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(202);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe("REVIEW_REQUIRED");
    expect(body.reasons.length).toBeGreaterThan(0);
    expect(body.reasons[0]).toHaveProperty("explanation");
  });

  it("skips requests without an identifiable wallet", () => {
    const next = vi.fn();
    const guard = abuseRiskGuard({ operation: "purchase", extract: () => null, mode: () => "enforce" });
    guard(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("demands step-up for a single moderate signal, and accepts proof", () => {
    for (let i = 0; i < 16; i++) {
      abuseActivityLedger.record({ operation: "payout_request", wallet: WALLET, target: `x${i}` }, true);
    }
    const denied = mockRes();
    const nextDenied = vi.fn();
    make("enforce", false, 10)(mockReq(), denied, nextDenied);
    expect(nextDenied).not.toHaveBeenCalled();
    expect(denied.statusCode).toBe(403);
    expect(denied.json.mock.calls[0][0].code).toBe("STEP_UP_REQUIRED");

    const nextOk = vi.fn();
    make("enforce", true, 10)(mockReq(), mockRes(), nextOk);
    expect(nextOk).toHaveBeenCalledOnce();
  });

  it("records the outcome to the ledger when the response finishes", () => {
    const res = mockRes();
    make("enforce")(mockReq(), res, vi.fn());
    res.statusCode = 200;
    res.emit("finish");
    expect(abuseActivityLedger.history(WALLET).completedOperations).toBe(1);
  });
});
