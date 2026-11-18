/**
 * Property tests for financial and ownership invariants (#1135).
 *
 * Example-based tests (domainInvariants.test.ts, payoutStatement.test.ts)
 * pin known cases; these generate hundreds of seeded cases per property to
 * find the inputs nobody thought to write down. Failures print a replay seed:
 *
 *   PROPERTY_SEED=<seed> PROPERTY_RUNS=1 npx vitest run src/tests/financialOwnershipInvariants.property.test.ts
 *
 * See docs/DOMAIN_INVARIANTS.md#property-tests for what each property guards.
 */

import { describe, it, expect } from "vitest";
import { DomainInvariantsService as INV } from "../services/domainInvariants.js";
import {
  PLATFORM_FEE_RATE,
  buildStatementLine,
  reconcilePayoutEvents,
  type PayoutEventSource,
  type PayoutPromptSource,
} from "../services/payoutReconciliation.js";
import { createRng, disguise, forAll, gen, type Gen, type Rng } from "./support/property.js";

const EPSILON = 1e-9;
const norm = (id: string) => id.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

interface Marketplace {
  prompts: Map<string, PayoutPromptSource>;
  events: PayoutEventSource[];
}

const settlement: Gen<Pick<PayoutEventSource, "txHash" | "status">> = (rng) =>
  gen.oneOf<Pick<PayoutEventSource, "txHash" | "status">>(
    { txHash: `tx${gen.int(0, 1e9)(rng)}` },
    { txHash: `tx${gen.int(0, 1e9)(rng)}` },
    { status: "pending" },
    { status: "resolved" },
  )(rng);

const marketplace = (priceGen: Gen<number> = gen.price()): Gen<Marketplace> => (rng) => {
  const prompts = new Map<string, PayoutPromptSource>();
  const promptCount = gen.int(1, 5)(rng);
  for (let i = 0; i < promptCount; i++) {
    prompts.set(`p${i}`, { onChainId: `${i}`, title: `Prompt ${i}`, price: priceGen(rng) });
  }
  const events = gen.array<PayoutEventSource>((r) => {
    const refunded = gen.bool(0.25)(r);
    return {
      _id: `e${gen.int(0, 1e9)(r)}`,
      promptId: `p${gen.int(0, promptCount)(r)}`, // may reference a missing prompt
      buyerWallet: gen.account()(r),
      disputeResolution: refunded ? "refunded" : null,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...settlement(r),
    };
  }, 0, 25)(rng);
  return { prompts, events };
};

// ---------------------------------------------------------------------------
// Financial: payout statements
// ---------------------------------------------------------------------------

describe("payout statement properties", () => {
  it("every statement balances: gross - fee - refunds === net", () => {
    forAll(marketplace(), ({ prompts, events }) => {
      const { summary, balanced } = reconcilePayoutEvents(events, prompts);
      expect(balanced).toBe(true);
      expect(
        Math.abs(summary.grossAmount - summary.platformFee - summary.refunds - summary.netSettlement),
      ).toBeLessThan(1e-5);
    });
  });

  it("each line conserves value and carries a single direction", () => {
    forAll(marketplace(), ({ prompts, events }) => {
      for (const event of events) {
        const line = buildStatementLine(event, prompts.get(String(event.promptId)));
        // gross is split exactly into fee + creator share — nothing created or lost.
        expect(Math.abs(line.grossAmount - line.platformFee - line.creatorAmount)).toBeLessThan(EPSILON);
        // fee is the platform rate, to the 4-dp precision statements are rounded to.
        expect(Math.abs(line.platformFee - line.grossAmount * PLATFORM_FEE_RATE)).toBeLessThanOrEqual(0.00005 + EPSILON);
        // INV-11: sales credit the creator, refunds debit; never mixed within a line.
        const amounts = [line.grossAmount, line.platformFee, line.creatorAmount];
        if (line.kind === "sale") amounts.forEach((a) => expect(a).toBeGreaterThanOrEqual(0));
        else amounts.forEach((a) => expect(a).toBeLessThanOrEqual(0));
        expect(INV.assertLedgerBalanceEntry(line.kind, line.grossAmount).passed).toBe(true);
      }
    });
  });

  it("a refund exactly reverses its sale (rollback nets to zero)", () => {
    forAll(gen.price(), (price) => {
      const prompts = new Map([["p0", { price }]]);
      const sale = { _id: "s", promptId: "p0", txHash: "tx1" };
      const refund = { _id: "r", promptId: "p0", txHash: "tx2", disputeResolution: "refunded" };
      const { summary } = reconcilePayoutEvents([sale, refund], prompts);
      expect(summary.netSettlement).toBeCloseTo(0, 9);
      expect(summary.platformFee).toBeCloseTo(0, 9);
      expect(summary.refunds).toBeCloseTo(summary.grossAmount, 9);
    });
  });

  it("summary is independent of event order (replay/backfill safe)", () => {
    forAll(marketplace(), ({ prompts, events }, rng) => {
      const a = reconcilePayoutEvents(events, prompts).summary;
      const b = reconcilePayoutEvents(gen.shuffle(events)(rng), prompts).summary;
      for (const key of ["grossAmount", "platformFee", "refunds", "netSettlement"] as const) {
        expect(Math.abs(a[key] - b[key])).toBeLessThan(EPSILON);
      }
      expect(a.settlementStatus).toBe(b.settlementStatus);
    });
  });

  it("summary status is the worst line status: failed > pending > settled", () => {
    forAll(marketplace(), ({ prompts, events }) => {
      const { statement, status } = reconcilePayoutEvents(events, prompts);
      const statuses = new Set(statement.map((l) => l.settlementStatus));
      const expected = statuses.has("failed") ? "failed" : statuses.has("pending") ? "pending" : "settled";
      expect(status).toBe(expected);
    });
  });

  it("corrupt prices never produce NaN or flip a sale into a creator debit", () => {
    const corruptPrice = gen.oneOf(Number.NaN, Infinity, -Infinity, -1, -0.0000001, 3.5);
    forAll(marketplace(corruptPrice), ({ prompts, events }) => {
      const { statement, summary, balanced } = reconcilePayoutEvents(events, prompts);
      expect(balanced).toBe(true);
      for (const value of Object.values(summary)) {
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
      for (const line of statement) {
        if (line.kind === "sale") expect(line.creatorAmount).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Financial: domain invariants
// ---------------------------------------------------------------------------

/** Random partition of 10,000 bps into 1..6 non-negative whole shares. */
const validSplit: Gen<number[]> = (rng) => {
  const cuts = gen.array(gen.int(0, 10_000), 0, 5)(rng).sort((a, b) => a - b);
  const bounds = [0, ...cuts, 10_000];
  return bounds.slice(1).map((b, i) => b - bounds[i]);
};

describe("INV-04 payout split properties", () => {
  it("accepts every partition of 10,000 bps into whole non-negative shares", () => {
    forAll(validSplit, (split) => {
      expect(INV.assertExactPayoutSplit(split).passed).toBe(true);
    });
  });

  it("rejects any split whose total is perturbed", () => {
    forAll(
      (rng) => ({ split: validSplit(rng), delta: gen.oneOf(-1, 1)(rng) * gen.int(1, 5_000)(rng) }),
      ({ split, delta }, rng) => {
        const i = gen.int(0, split.length - 1)(rng);
        const perturbed = split.map((s, j) => (j === i ? s + delta : s));
        expect(INV.assertExactPayoutSplit(perturbed).passed).toBe(false);
      },
    );
  });

  it("rejects negative shares even when the total is exactly 10,000", () => {
    forAll(
      (rng) => ({ split: validSplit(rng), steal: gen.int(1, 10_000)(rng) }),
      ({ split, steal }) => {
        // One party is paid more than the sale; another "pays" the difference.
        const exploited = [split[0] + steal, ...split.slice(1), -steal];
        expect(exploited.reduce((a, b) => a + b, 0)).toBe(10_000);
        expect(INV.assertExactPayoutSplit(exploited).passed).toBe(false);
      },
    );
  });

  it("rejects fractional shares even when the total is exactly 10,000", () => {
    forAll(gen.int(1, 9_998), (bps) => {
      expect(INV.assertExactPayoutSplit([bps + 0.5, 10_000 - bps - 0.5]).passed).toBe(false);
    });
  });
});

describe("INV-07 escrow conservation properties", () => {
  const stroops: Gen<bigint> = (rng) => BigInt(gen.int(0, 2 ** 30)(rng)) * BigInt(gen.int(1, 2 ** 20)(rng));

  it("passes iff deposit === payouts + fee", () => {
    forAll(
      (rng) => ({ payouts: stroops(rng), fee: stroops(rng), delta: BigInt(gen.int(-1_000, 1_000)(rng)) }),
      ({ payouts, fee, delta }) => {
        const result = INV.assertEscrowBalanceConservation(payouts + fee + delta, payouts, fee);
        expect(result.passed).toBe(delta === 0n);
      },
    );
  });
});

describe("INV-01 price properties", () => {
  it("whole non-negative stroops pass, negatives fail (number and bigint agree)", () => {
    forAll(gen.int(-1_000_000_000, 1_000_000_000), (price) => {
      const expected = price >= 0;
      expect(INV.assertPriceNonNegative(price).passed).toBe(expected);
      expect(INV.assertPriceNonNegative(BigInt(price)).passed).toBe(expected);
    });
  });

  it("non-integral prices are rejected instead of throwing", () => {
    const bad = gen.oneOf(Number.NaN, Infinity, -Infinity, 0.5, 1.0000001, 2 ** 60);
    forAll(bad, (price) => {
      expect(() => INV.assertPriceNonNegative(price)).not.toThrow();
      expect(INV.assertPriceNonNegative(price).passed).toBe(false);
    });
  });
});

describe("INV-11 ledger direction properties", () => {
  const entryType = gen.oneOf("sale", "fee", "refund", "adjustment", "payout" as const);
  const amount: Gen<number> = (rng) =>
    rng() < 0.1 ? gen.oneOf(Number.NaN, Infinity, -Infinity)(rng) : (rng() - 0.5) * 2_000_000;

  it("sales credit, fees/refunds/payouts debit, adjustments go either way, non-finite never passes", () => {
    forAll(
      (rng) => ({ type: entryType(rng), amount: amount(rng) }),
      ({ type, amount: value }) => {
        const expected = !Number.isFinite(value)
          ? false
          : type === "adjustment"
            ? true
            : type === "sale"
              ? value >= 0
              : value <= 0;
        expect(INV.assertLedgerBalanceEntry(type, value).passed).toBe(expected);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Ownership and authorization
// ---------------------------------------------------------------------------

interface TransferAttempt {
  prompt: number;
  /** When false the caller presents a stale/forged expected owner. */
  fresh: boolean;
  claimedOwner: string;
  next: string;
}

const transferAttempts: Gen<TransferAttempt[]> = gen.array(
  (rng) => ({
    prompt: gen.int(0, 2)(rng),
    fresh: gen.bool(0.7)(rng),
    claimedOwner: gen.account()(rng),
    next: gen.account()(rng),
  }),
  1,
  40,
);

describe("INV-12 ownership transition properties (stateful model)", () => {
  it("ownership only moves from the verified owner to a different account, and stale retries are rejected", () => {
    forAll(transferAttempts, (attempts, rng) => {
      const owners = ["GACCOUNT0", "GACCOUNT1", "GACCOUNT2"].map(norm);
      let applied = 0;

      for (const attempt of attempts) {
        const current = owners[attempt.prompt];
        const expectedOwner = attempt.fresh ? current : attempt.claimedOwner;
        const result = INV.assertOwnershipTransition(
          disguise(expectedOwner, rng),
          current,
          disguise(attempt.next, rng),
        );

        const shouldPass = norm(expectedOwner) === current && norm(attempt.next) !== current;
        expect(result.passed).toBe(shouldPass);
        if (!result.passed) {
          expect(result.message).toBeTruthy();
          continue;
        }

        owners[attempt.prompt] = norm(attempt.next);
        applied++;

        // Retry path: replaying the same request after it succeeded must be
        // rejected, because the owner it names is no longer current.
        const replay = INV.assertOwnershipTransition(expectedOwner, owners[attempt.prompt], attempt.next);
        expect(replay.passed).toBe(false);
      }

      // Every prompt still has exactly one well-formed owner.
      for (const owner of owners) expect(owner).toMatch(/^gaccount\d$/);
      expect(applied).toBeLessThanOrEqual(attempts.length);
    });
  });

  it("blank identities never authorize a transition", () => {
    const blank = gen.oneOf("", " ", "\t", "  \n");
    forAll(
      (rng) => ({ slot: gen.int(0, 2)(rng), blank: blank(rng), a: gen.account()(rng), b: gen.account()(rng) }),
      ({ slot, blank: empty, a, b }) => {
        const ids = [a, a, b];
        ids[slot] = empty;
        expect(INV.assertOwnershipTransition(ids[0], ids[1], ids[2]).passed).toBe(false);
      },
    );
  });
});

describe("INV-02/INV-03 purchase authorization properties", () => {
  it("a seller can never buy their own prompt, however the address is cased or padded", () => {
    forAll(gen.account(), (account, rng) => {
      expect(INV.assertNoSelfPurchase(disguise(account, rng), disguise(account, rng)).passed).toBe(false);
    });
  });

  it("only the current owner may sell", () => {
    forAll(
      (rng) => ({ owner: gen.account()(rng), seller: gen.account()(rng) }),
      ({ owner, seller }, rng) => {
        const result = INV.assertSellerOwnership(owner, disguise(seller, rng));
        expect(result.passed).toBe(norm(owner) === norm(seller));
      },
    );
  });
});

describe("INV-10/INV-13 entitlement authorization properties", () => {
  it("an active entitlement always traces to authorship or a fulfilled purchase (exhaustive)", () => {
    for (const active of [true, false]) {
      for (const author of [true, false]) {
        for (const purchased of [true, false]) {
          const passed = INV.assertEntitlementIntegrity(active, author, purchased).passed;
          expect(passed).toBe(!active || author || purchased);
        }
      }
    }
  });

  it("grants need a source reference and revocations need a reason; whitespace is not evidence", () => {
    const text = gen.oneOf("", "   ", "purchase:tx123", "refund approved", undefined);
    forAll(
      (rng) => ({
        action: gen.oneOf("grant", "revoke" as const)(rng),
        userAddress: gen.oneOf("", " ", "GACCOUNT1")(rng),
        promptId: gen.oneOf("", "42")(rng),
        sourceRef: text(rng),
        reason: text(rng),
      }),
      (input) => {
        const hasIdentity = input.userAddress.trim() !== "" && input.promptId.trim() !== "";
        const evidence = input.action === "grant" ? input.sourceRef : input.reason;
        const expected = hasIdentity && Boolean(evidence?.trim());
        expect(INV.assertEntitlementTransition(input).passed).toBe(expected);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Harness self-check: failures must be reproducible from the printed seed.
// ---------------------------------------------------------------------------

describe("property harness", () => {
  it("reports a replayable seed and counterexample", () => {
    const failing = () => forAll(gen.int(0, 100), (n) => expect(n).toBeLessThan(50), { runs: 200 });
    let message = "";
    try {
      failing();
    } catch (error) {
      message = (error as Error).message;
    }
    const seed = Number(/PROPERTY_SEED=(\d+)/.exec(message)?.[1]);
    expect(Number.isInteger(seed)).toBe(true);

    const counterexample = Number(/Counterexample: (\d+)/.exec(message)?.[1]);
    const replayed = gen.int(0, 100)(createRng(seed) as Rng);
    expect(replayed).toBe(counterexample);
    expect(replayed).toBeGreaterThanOrEqual(50);
  });
});
