/**
 * Risk-scored abuse detection for suspicious high-impact operations.
 *
 * Every high-impact operation (unlock, purchase, payout request, price
 * change, ownership transfer, ...) is scored 0..100 from a small set of
 * explainable signals. The score maps to a graduated response:
 *
 *   allow    → proceed untouched (the overwhelmingly common path)
 *   step_up  → proceed only after fresh wallet re-verification
 *   review   → hold the operation and queue it for a human reviewer
 *   block    → reject (only with corroborated, critical evidence)
 *
 * Design rules that keep legitimate low-risk use unblocked:
 *   - Every fired signal carries code, observed value, threshold and a
 *     human-readable explanation, so a reviewer can see exactly why.
 *   - One signal alone can never push past `step_up`; `review`/`block`
 *     require corroboration from at least two distinct signals.
 *   - Low-impact operations are score-dampened by `impactWeight`.
 *   - Established good history (clean age, completed purchases) subtracts a
 *     bounded trust credit; it can never fully cancel a critical signal.
 *   - Scoring is pure and deterministic: same input → same decision.
 *
 * The pure functions below have no I/O. `AbuseActivityLedger` and
 * `AbuseReviewQueue` are small in-memory stores (per process, like the rate
 * limiter) used by `middleware/abuseRiskGuard.ts`.
 *
 * Runbook: docs/abuse-risk-detection.md
 */

import { createHash } from "crypto";

export type HighImpactOperation =
  | "unlock"
  | "purchase"
  | "bulk_purchase"
  | "price_change"
  | "ownership_transfer"
  | "payout_request"
  | "api_key_create"
  | "bulk_import";

export type RiskDecision = "allow" | "step_up" | "review" | "block";

export type RiskMode = "off" | "shadow" | "enforce";

export type RiskSignalCode =
  | "velocity_burst"
  | "failed_attempt_streak"
  | "new_account"
  | "amount_spike"
  | "ip_fanout"
  | "repeat_target"
  | "self_dealing"
  | "dispute_history"
  | "fresh_counterparty";

export interface RiskSignal {
  code: RiskSignalCode;
  /** Points contributed before the operation impact weight is applied. */
  points: number;
  observed: number | string | boolean;
  threshold: number | string | boolean;
  explanation: string;
  /** Critical signals are the only ones that can justify a `block`. */
  critical: boolean;
}

export interface OperationContext {
  operation: HighImpactOperation;
  /** Stellar account performing the operation (hashed before storage). */
  wallet: string;
  /** Stable id of the thing acted on (prompt id, bundle id, ...). */
  target?: string;
  /** Counterparty wallet (creator for a purchase, recipient for a transfer). */
  counterparty?: string;
  /** XLM-equivalent value moved by this operation, when applicable. */
  amount?: number;
  ip?: string;
  now?: number;
}

export interface SubjectHistory {
  /** Wallet first-seen time (epoch ms); undefined if never seen. */
  firstSeenAt?: number;
  completedOperations: number;
  disputedOperations: number;
  /** Median/typical amount of prior completed operations. */
  typicalAmount?: number;
}

export interface RecentActivity {
  /** Operations of any kind by this wallet inside the velocity window. */
  operationsInWindow: number;
  /** Consecutive failed attempts with no success in between. */
  failedStreak: number;
  /** Distinct IPs used by this wallet inside the window. */
  distinctIpsInWindow: number;
  /** Times this wallet hit the same target inside the window. */
  sameTargetInWindow: number;
  /** Counterparty first-seen time (epoch ms), if known. */
  counterpartyFirstSeenAt?: number;
}

export interface RiskThresholds {
  stepUpAt: number;
  reviewAt: number;
  blockAt: number;
  velocityWindowMs: number;
  maxOperationsInWindow: number;
  failedStreakLimit: number;
  newAccountAgeMs: number;
  amountSpikeRatio: number;
  /** Absolute amount above which a brand-new wallet is always notable. */
  newAccountHighAmount: number;
  maxDistinctIps: number;
  maxSameTarget: number;
  freshCounterpartyAgeMs: number;
  disputeRatioLimit: number;
  /** Max points history may subtract. */
  maxTrustCredit: number;
}

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  stepUpAt: 35,
  reviewAt: 65,
  blockAt: 90,
  velocityWindowMs: 10 * 60 * 1000,
  maxOperationsInWindow: 8,
  failedStreakLimit: 3,
  newAccountAgeMs: 24 * 60 * 60 * 1000,
  amountSpikeRatio: 5,
  newAccountHighAmount: 500,
  maxDistinctIps: 3,
  maxSameTarget: 3,
  freshCounterpartyAgeMs: 60 * 60 * 1000,
  disputeRatioLimit: 0.3,
  maxTrustCredit: 15,
};

/**
 * How much a given operation matters. Reads of already-owned content are
 * deliberately low so ordinary browsing/unlocking is almost never challenged;
 * money-out and control-plane changes are weighted up.
 */
export const OPERATION_IMPACT_WEIGHT: Record<HighImpactOperation, number> = {
  unlock: 0.6,
  purchase: 0.9,
  bulk_purchase: 1.0,
  price_change: 0.8,
  ownership_transfer: 1.2,
  payout_request: 1.3,
  api_key_create: 1.0,
  bulk_import: 0.9,
};

/** Operations that fail closed (step-up) when risk data is unavailable. */
export const FAIL_CLOSED_OPERATIONS: ReadonlySet<HighImpactOperation> = new Set([
  "ownership_transfer",
  "payout_request",
]);

export interface RiskAssessment {
  operation: HighImpactOperation;
  score: number;
  rawScore: number;
  trustCredit: number;
  impactWeight: number;
  decision: RiskDecision;
  signals: RiskSignal[];
  /** Plain-language summary suitable for audit logs and reviewer UIs. */
  summary: string;
}

export function hashSubject(wallet: string): string {
  return createHash("sha256").update(wallet.trim().toLowerCase()).digest("hex");
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Collect every signal that fires for this context. Order is stable. */
export function collectSignals(
  ctx: OperationContext,
  history: SubjectHistory,
  recent: RecentActivity,
  thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS,
): RiskSignal[] {
  const now = ctx.now ?? Date.now();
  const signals: RiskSignal[] = [];

  if (recent.operationsInWindow > thresholds.maxOperationsInWindow) {
    const over = recent.operationsInWindow - thresholds.maxOperationsInWindow;
    signals.push({
      code: "velocity_burst",
      points: Math.min(40, 15 + over * 3),
      observed: recent.operationsInWindow,
      threshold: thresholds.maxOperationsInWindow,
      explanation: `${recent.operationsInWindow} high-impact operations in ${Math.round(thresholds.velocityWindowMs / 60000)} min (normal ≤ ${thresholds.maxOperationsInWindow}).`,
      critical: false,
    });
  }

  if (recent.failedStreak >= thresholds.failedStreakLimit) {
    signals.push({
      code: "failed_attempt_streak",
      points: Math.min(35, 15 + (recent.failedStreak - thresholds.failedStreakLimit) * 5),
      observed: recent.failedStreak,
      threshold: thresholds.failedStreakLimit,
      explanation: `${recent.failedStreak} consecutive failed attempts without a success (limit ${thresholds.failedStreakLimit}).`,
      critical: false,
    });
  }

  const ageMs =
    history.firstSeenAt === undefined ? 0 : Math.max(0, now - history.firstSeenAt);
  const isNewAccount = history.firstSeenAt === undefined || ageMs < thresholds.newAccountAgeMs;
  if (isNewAccount && (ctx.amount ?? 0) >= thresholds.newAccountHighAmount) {
    signals.push({
      code: "new_account",
      points: 25,
      observed: `${Math.round(ageMs / 60000)}m old, amount ${ctx.amount}`,
      threshold: `age ≥ ${Math.round(thresholds.newAccountAgeMs / 3600000)}h or amount < ${thresholds.newAccountHighAmount}`,
      explanation: `Account is under ${Math.round(thresholds.newAccountAgeMs / 3600000)}h old and the amount (${ctx.amount}) is high for a new account.`,
      critical: false,
    });
  }

  if (
    ctx.amount !== undefined &&
    history.typicalAmount !== undefined &&
    history.typicalAmount > 0 &&
    history.completedOperations >= 3
  ) {
    const ratio = ctx.amount / history.typicalAmount;
    if (ratio >= thresholds.amountSpikeRatio) {
      signals.push({
        code: "amount_spike",
        points: Math.min(30, 15 + Math.round(ratio)),
        observed: Number(ratio.toFixed(2)),
        threshold: thresholds.amountSpikeRatio,
        explanation: `Amount is ${ratio.toFixed(1)}× this wallet's typical amount (flagged at ${thresholds.amountSpikeRatio}×).`,
        critical: false,
      });
    }
  }

  if (recent.distinctIpsInWindow > thresholds.maxDistinctIps) {
    signals.push({
      code: "ip_fanout",
      points: 20,
      observed: recent.distinctIpsInWindow,
      threshold: thresholds.maxDistinctIps,
      explanation: `${recent.distinctIpsInWindow} distinct IP addresses used by one wallet in the window (normal ≤ ${thresholds.maxDistinctIps}).`,
      critical: false,
    });
  }

  if (recent.sameTargetInWindow > thresholds.maxSameTarget) {
    signals.push({
      code: "repeat_target",
      points: 15,
      observed: recent.sameTargetInWindow,
      threshold: thresholds.maxSameTarget,
      explanation: `The same target was hit ${recent.sameTargetInWindow} times in the window (normal ≤ ${thresholds.maxSameTarget}).`,
      critical: false,
    });
  }

  if (
    ctx.counterparty &&
    ctx.counterparty.trim().toLowerCase() === ctx.wallet.trim().toLowerCase() &&
    ["purchase", "bulk_purchase", "ownership_transfer"].includes(ctx.operation)
  ) {
    signals.push({
      code: "self_dealing",
      points: 45,
      observed: true,
      threshold: false,
      explanation: "Buyer and counterparty are the same wallet (possible wash trade or fee/royalty gaming).",
      critical: true,
    });
  }

  if (
    ctx.counterparty &&
    recent.counterpartyFirstSeenAt !== undefined &&
    now - recent.counterpartyFirstSeenAt < thresholds.freshCounterpartyAgeMs &&
    (ctx.operation === "ownership_transfer" || ctx.operation === "payout_request")
  ) {
    signals.push({
      code: "fresh_counterparty",
      points: 25,
      observed: `${Math.round((now - recent.counterpartyFirstSeenAt) / 60000)}m old`,
      threshold: `≥ ${Math.round(thresholds.freshCounterpartyAgeMs / 60000)}m`,
      explanation: "Funds or ownership are moving to a counterparty wallet created moments ago.",
      critical: true,
    });
  }

  if (history.completedOperations + history.disputedOperations >= 5) {
    const total = history.completedOperations + history.disputedOperations;
    const ratio = history.disputedOperations / total;
    if (ratio >= thresholds.disputeRatioLimit) {
      signals.push({
        code: "dispute_history",
        points: 20,
        observed: Number(ratio.toFixed(2)),
        threshold: thresholds.disputeRatioLimit,
        explanation: `${history.disputedOperations} of ${total} prior operations were disputed (${Math.round(ratio * 100)}%, limit ${Math.round(thresholds.disputeRatioLimit * 100)}%).`,
        critical: false,
      });
    }
  }

  return signals;
}

/** Bounded credit for clean, established history. Never negative. */
export function computeTrustCredit(
  history: SubjectHistory,
  now: number,
  thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS,
): number {
  if (history.firstSeenAt === undefined) return 0;
  const ageDays = Math.max(0, now - history.firstSeenAt) / (24 * 60 * 60 * 1000);
  const clean = Math.max(0, history.completedOperations - history.disputedOperations * 3);
  const credit = Math.min(ageDays, 30) / 30 * 6 + Math.min(clean, 20) / 20 * 9;
  return Math.min(thresholds.maxTrustCredit, Math.round(credit));
}

function summarize(decision: RiskDecision, signals: RiskSignal[]): string {
  if (signals.length === 0) return "No risk signals fired.";
  const codes = signals.map((s) => s.code).join(", ");
  return `Decision ${decision}; signals: ${codes}.`;
}

/**
 * Pure scoring entry point. Deterministic for a given input.
 */
export function assessRisk(
  ctx: OperationContext,
  history: SubjectHistory,
  recent: RecentActivity,
  thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS,
): RiskAssessment {
  const now = ctx.now ?? Date.now();
  const signals = collectSignals(ctx, history, recent, thresholds);
  const impactWeight = OPERATION_IMPACT_WEIGHT[ctx.operation];
  const rawScore = signals.reduce((sum, s) => sum + s.points, 0);

  // No signals → nothing to be suspicious about, regardless of anything else.
  if (signals.length === 0) {
    return {
      operation: ctx.operation,
      score: 0,
      rawScore: 0,
      trustCredit: 0,
      impactWeight,
      decision: "allow",
      signals,
      summary: summarize("allow", signals),
    };
  }

  const trustCredit = computeTrustCredit(history, now, thresholds);
  // A critical signal is never fully cancelled by history.
  const hasCritical = signals.some((s) => s.critical);
  const credit = hasCritical ? Math.min(trustCredit, Math.floor(rawScore / 3)) : trustCredit;
  const score = clampScore(rawScore * impactWeight - credit);

  let decision: RiskDecision = "allow";
  if (score >= thresholds.stepUpAt) decision = "step_up";

  // Corroboration: stronger responses need ≥ 2 distinct signals.
  if (signals.length >= 2) {
    if (score >= thresholds.reviewAt) decision = "review";
    if (score >= thresholds.blockAt && hasCritical) decision = "block";
  }

  return {
    operation: ctx.operation,
    score,
    rawScore,
    trustCredit: credit,
    impactWeight,
    decision,
    signals,
    summary: summarize(decision, signals),
  };
}

/**
 * Decision used when risk data cannot be read. Money-out and ownership
 * operations step up; everything else is allowed so a risk-store outage
 * never takes down ordinary low-risk traffic.
 */
export function degradedAssessment(
  operation: HighImpactOperation,
  reason: string,
): RiskAssessment {
  const failClosed = FAIL_CLOSED_OPERATIONS.has(operation);
  return {
    operation,
    score: failClosed ? DEFAULT_RISK_THRESHOLDS.stepUpAt : 0,
    rawScore: 0,
    trustCredit: 0,
    impactWeight: OPERATION_IMPACT_WEIGHT[operation],
    decision: failClosed ? "step_up" : "allow",
    signals: [],
    summary: `Risk data unavailable (${reason}); ${failClosed ? "failing closed to step-up" : "failing open"}.`,
  };
}

export function parseRiskMode(value: string | undefined): RiskMode {
  const v = (value ?? "").trim().toLowerCase();
  return v === "off" || v === "enforce" || v === "shadow" ? v : "shadow";
}

/**
 * What the caller should actually do. In `shadow` mode every decision is
 * recorded but nothing is enforced; in `off` mode nothing is even recorded.
 */
export function effectiveDecision(mode: RiskMode, decision: RiskDecision): RiskDecision {
  return mode === "enforce" ? decision : "allow";
}

// ─── Activity ledger ─────────────────────────────────────────────────────────

interface ActivityEvent {
  at: number;
  operation: HighImpactOperation;
  ok: boolean;
  target?: string;
  ipHash?: string;
  amount?: number;
}

interface SubjectRecord {
  firstSeenAt: number;
  events: ActivityEvent[];
  completed: number;
  disputed: number;
  amountSum: number;
}

export interface LedgerOptions {
  windowMs?: number;
  maxEventsPerSubject?: number;
  maxSubjects?: number;
}

/**
 * Bounded in-memory activity store. Only hashed wallets and hashed IPs are
 * kept, never raw identifiers, and memory is capped per subject and overall.
 * State is per process: a restart resets velocity counters (documented as a
 * fail-open edge case) but never produces a false positive.
 */
export class AbuseActivityLedger {
  private readonly subjects = new Map<string, SubjectRecord>();
  private readonly windowMs: number;
  private readonly maxEvents: number;
  private readonly maxSubjects: number;

  constructor(options: LedgerOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_RISK_THRESHOLDS.velocityWindowMs;
    this.maxEvents = options.maxEventsPerSubject ?? 200;
    this.maxSubjects = options.maxSubjects ?? 50_000;
  }

  private ensure(subject: string, now: number): SubjectRecord {
    let record = this.subjects.get(subject);
    if (!record) {
      if (this.subjects.size >= this.maxSubjects) {
        // Evict the oldest-inserted subject; Map preserves insertion order.
        const oldest = this.subjects.keys().next().value;
        if (oldest !== undefined) this.subjects.delete(oldest);
      }
      record = { firstSeenAt: now, events: [], completed: 0, disputed: 0, amountSum: 0 };
      this.subjects.set(subject, record);
    }
    return record;
  }

  record(ctx: OperationContext, ok: boolean): void {
    const now = ctx.now ?? Date.now();
    const record = this.ensure(hashSubject(ctx.wallet), now);
    record.events.push({
      at: now,
      operation: ctx.operation,
      ok,
      target: ctx.target,
      ipHash: ctx.ip ? hashSubject(ctx.ip) : undefined,
      amount: ctx.amount,
    });
    if (record.events.length > this.maxEvents) {
      record.events.splice(0, record.events.length - this.maxEvents);
    }
    if (ok) {
      record.completed += 1;
      record.amountSum += ctx.amount ?? 0;
    }
  }

  recordDispute(wallet: string, now: number = Date.now()): void {
    this.ensure(hashSubject(wallet), now).disputed += 1;
  }

  history(wallet: string): SubjectHistory {
    const record = this.subjects.get(hashSubject(wallet));
    if (!record) return { completedOperations: 0, disputedOperations: 0 };
    return {
      firstSeenAt: record.firstSeenAt,
      completedOperations: record.completed,
      disputedOperations: record.disputed,
      typicalAmount: record.completed > 0 ? record.amountSum / record.completed : undefined,
    };
  }

  recent(ctx: OperationContext): RecentActivity {
    const now = ctx.now ?? Date.now();
    const record = this.subjects.get(hashSubject(ctx.wallet));
    const counterpartyRecord = ctx.counterparty
      ? this.subjects.get(hashSubject(ctx.counterparty))
      : undefined;
    const base: RecentActivity = {
      operationsInWindow: 0,
      failedStreak: 0,
      distinctIpsInWindow: 0,
      sameTargetInWindow: 0,
      counterpartyFirstSeenAt: counterpartyRecord?.firstSeenAt,
    };
    if (!record) return base;

    const windowStart = now - this.windowMs;
    const inWindow = record.events.filter((e) => e.at >= windowStart);
    const ips = new Set(inWindow.map((e) => e.ipHash).filter(Boolean));
    let streak = 0;
    for (let i = record.events.length - 1; i >= 0 && !record.events[i].ok; i--) streak++;

    return {
      ...base,
      operationsInWindow: inWindow.length,
      failedStreak: streak,
      distinctIpsInWindow: ips.size,
      sameTargetInWindow: ctx.target
        ? inWindow.filter((e) => e.target === ctx.target).length
        : 0,
    };
  }

  /** Forget one wallet (rollback of a false positive) or everything. */
  reset(wallet?: string): void {
    if (wallet) this.subjects.delete(hashSubject(wallet));
    else this.subjects.clear();
  }

  get size(): number {
    return this.subjects.size;
  }
}

// ─── Review queue ────────────────────────────────────────────────────────────

export type ReviewStatus = "pending" | "approved" | "rejected" | "consumed";

export interface ReviewItem {
  id: string;
  createdAt: number;
  operation: HighImpactOperation;
  subject: string;
  target?: string;
  score: number;
  decision: RiskDecision;
  signals: RiskSignal[];
  status: ReviewStatus;
  resolvedAt?: number;
  resolvedBy?: string;
  resolutionNote?: string;
}

export class AbuseReviewQueue {
  private readonly items = new Map<string, ReviewItem>();
  private seq = 0;

  constructor(private readonly maxItems = 5000) {}

  enqueue(ctx: OperationContext, assessment: RiskAssessment): ReviewItem {
    const now = ctx.now ?? Date.now();
    const subject = hashSubject(ctx.wallet);
    // De-duplicate: one pending item per subject+operation+target.
    for (const item of this.items.values()) {
      if (
        item.status === "pending" &&
        item.subject === subject &&
        item.operation === ctx.operation &&
        item.target === ctx.target
      ) {
        item.score = Math.max(item.score, assessment.score);
        item.signals = assessment.signals;
        return item;
      }
    }
    if (this.items.size >= this.maxItems) {
      // Drop the oldest resolved item; never drop a pending one.
      for (const [id, item] of this.items) {
        if (item.status !== "pending") {
          this.items.delete(id);
          break;
        }
      }
    }
    const item: ReviewItem = {
      id: `risk_${now.toString(36)}_${(++this.seq).toString(36)}`,
      createdAt: now,
      operation: ctx.operation,
      subject,
      target: ctx.target,
      score: assessment.score,
      decision: assessment.decision,
      signals: assessment.signals,
      status: "pending",
    };
    this.items.set(item.id, item);
    return item;
  }

  list(status?: ReviewStatus): ReviewItem[] {
    return [...this.items.values()]
      .filter((i) => !status || i.status === status)
      .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
  }

  get(id: string): ReviewItem | undefined {
    return this.items.get(id);
  }

  /**
   * Spend a reviewer approval for this exact subject+operation+target. An
   * approval releases one held operation, then is marked `consumed`, so it
   * cannot be replayed for later activity.
   */
  consumeApproval(wallet: string, operation: HighImpactOperation, target?: string): boolean {
    const subject = hashSubject(wallet);
    for (const item of this.items.values()) {
      if (
        item.status === "approved" &&
        item.subject === subject &&
        item.operation === operation &&
        item.target === target
      ) {
        item.status = "consumed";
        return true;
      }
    }
    return false;
  }

  resolve(
    id: string,
    status: "approved" | "rejected",
    actor: string,
    note?: string,
    now: number = Date.now(),
  ): ReviewItem | undefined {
    const item = this.items.get(id);
    if (!item || item.status !== "pending") return undefined;
    item.status = status;
    item.resolvedAt = now;
    item.resolvedBy = actor;
    item.resolutionNote = note;
    return item;
  }

  clear(): void {
    this.items.clear();
  }
}

export const abuseActivityLedger = new AbuseActivityLedger();
export const abuseReviewQueue = new AbuseReviewQueue();

// ─── Orchestration ───────────────────────────────────────────────────────────

export interface EvaluateOptions {
  ledger?: AbuseActivityLedger;
  queue?: AbuseReviewQueue;
  thresholds?: RiskThresholds;
}

export interface EvaluationOutcome {
  assessment: RiskAssessment;
  /** Decision after applying mode, an approved review, and degradation rules. */
  action: RiskDecision;
  reviewId?: string;
  /** True when an approved review released a held operation. */
  releasedByReview: boolean;
}

/**
 * Score an operation and enqueue it for review when warranted. Never throws:
 * a failure in the risk subsystem degrades per `degradedAssessment`.
 */
export function evaluateOperation(
  ctx: OperationContext,
  mode: RiskMode,
  options: EvaluateOptions = {},
): EvaluationOutcome {
  const ledger = options.ledger ?? abuseActivityLedger;
  const queue = options.queue ?? abuseReviewQueue;

  let assessment: RiskAssessment;
  try {
    assessment = assessRisk(
      ctx,
      ledger.history(ctx.wallet),
      ledger.recent(ctx),
      options.thresholds ?? DEFAULT_RISK_THRESHOLDS,
    );
  } catch (err) {
    assessment = degradedAssessment(
      ctx.operation,
      err instanceof Error ? err.message : "unknown error",
    );
  }

  // A reviewer approval releases exactly one held operation and is spent
  // before anything new is queued, so an approved item never spawns a
  // duplicate pending review.
  const releasedByReview =
    assessment.decision === "review" &&
    mode === "enforce" &&
    queue.consumeApproval(ctx.wallet, ctx.operation, ctx.target);

  let reviewId: string | undefined;
  if (!releasedByReview && (assessment.decision === "review" || assessment.decision === "block")) {
    try {
      reviewId = queue.enqueue(ctx, assessment).id;
    } catch {
      // Queue failure must not turn a decision into an outage.
    }
  }

  const action = releasedByReview ? "allow" : effectiveDecision(mode, assessment.decision);

  return { assessment, action, reviewId, releasedByReview };
}
