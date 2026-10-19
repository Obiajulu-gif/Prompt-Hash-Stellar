/**
 * Deterministic fault injection for chaos-style workflow tests (#964).
 *
 * Nothing in this file reads the wall clock or Math.random. A scripted or
 * seeded schedule injects the same faults, in the same order, on every run, so
 * a chaos test that passes once keeps passing and a failure can be replayed.
 */

export type Fault = "ok" | "network" | "timeout" | "crash";

/** Thrown in place of a real failure. Tests catch it to model a dropped call or a crash. */
export class InjectedFault extends Error {
  constructor(readonly fault: Exclude<Fault, "ok">) {
    super(`injected ${fault}`);
    this.name = "InjectedFault";
  }
}

/** mulberry32: small, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plays `script` one entry per call, then reports "ok" forever. */
export function scriptedFaults(script: Fault[]): () => Fault {
  let index = 0;
  return () => script[index++] ?? "ok";
}

/** Fails each call with probability `failureRate`, using a seeded PRNG. */
export function seededFaults(
  seed: number,
  failureRate: number,
  kind: Exclude<Fault, "ok"> = "network",
): () => Fault {
  const random = mulberry32(seed);
  return () => (random() < failureRate ? kind : "ok");
}

/**
 * The request never reaches `fn` when the schedule says it fails. Models a
 * connection that drops before the server sees it.
 */
export function failBefore<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  next: () => Fault,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const fault = next();
    if (fault !== "ok") throw new InjectedFault(fault);
    return fn(...args);
  };
}

/**
 * `fn` runs and its side effects happen, then the response is lost. Models the
 * at-least-once case where the sender cannot tell whether the work committed.
 */
export function loseResponseAfter<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  next: () => Fault,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const result = await fn(...args);
    const fault = next();
    if (fault !== "ok") throw new InjectedFault(fault);
    return result;
  };
}
