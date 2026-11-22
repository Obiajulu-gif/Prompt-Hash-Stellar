/**
 * Minimal seeded property-testing harness (#1135).
 *
 * Deliberately dependency-free: generators are plain functions of a seeded
 * PRNG, so every failure is reproducible from the seed printed in the error.
 *
 *   PROPERTY_SEED=1234 npx vitest run src/tests/financialOwnershipInvariants.property.test.ts
 *   PROPERTY_RUNS=5000 npx vitest run ...   # deeper local exploration
 */

export type Rng = () => number;

/** mulberry32 — small, fast, and good enough for test-case generation. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Gen<T> = (rng: Rng) => T;

export const gen = {
  int:
    (min: number, max: number): Gen<number> =>
    (rng) =>
      min + Math.floor(rng() * (max - min + 1)),
  bool: (pTrue = 0.5): Gen<boolean> => (rng) => rng() < pTrue,
  oneOf:
    <T>(...values: T[]): Gen<T> =>
    (rng) =>
      values[Math.floor(rng() * values.length)],
  array:
    <T>(item: Gen<T>, minLen: number, maxLen: number): Gen<T[]> =>
    (rng) =>
      Array.from({ length: gen.int(minLen, maxLen)(rng) }, () => item(rng)),
  /** XLM price with up to 7 decimal places (stroop precision), occasionally many more. */
  price: (): Gen<number> => (rng) => {
    const whole = gen.int(0, 10_000)(rng);
    const fraction = gen.int(0, 9_999_999)(rng) / 10_000_000;
    return rng() < 0.1 ? whole + rng() : whole + fraction;
  },
  /** Stellar-style account id; random case and padding exercise normalisation. */
  account: (pool = 6): Gen<string> => (rng) => `GACCOUNT${gen.int(0, pool - 1)(rng)}`,
  shuffle:
    <T>(items: T[]): Gen<T[]> =>
    (rng) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
};

/** Vary case and surrounding whitespace without changing identity. */
export function disguise(id: string, rng: Rng): string {
  const cased = rng() < 0.5 ? id.toLowerCase() : id.toUpperCase();
  return `${" ".repeat(gen.int(0, 2)(rng))}${cased}${" ".repeat(gen.int(0, 2)(rng))}`;
}

const DEFAULT_RUNS = Number(process.env.PROPERTY_RUNS ?? 300);
const BASE_SEED = process.env.PROPERTY_SEED ? Number(process.env.PROPERTY_SEED) : 0x5eed_1135;

function describeCase(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 2);
}

/**
 * Check `property` against `runs` generated cases. Each case gets its own
 * derived seed so a failure can be replayed in isolation via PROPERTY_SEED.
 */
export function forAll<T>(
  generator: Gen<T>,
  property: (value: T, rng: Rng) => void,
  options: { runs?: number; seed?: number } = {},
): void {
  const runs = options.runs ?? DEFAULT_RUNS;
  const seed = options.seed ?? BASE_SEED;
  for (let run = 0; run < runs; run++) {
    const caseSeed = (seed + run * 0x9e3779b9) >>> 0;
    const rng = createRng(caseSeed);
    const value = generator(rng);
    try {
      property(value, rng);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Property failed on run ${run} (replay: PROPERTY_SEED=${caseSeed} PROPERTY_RUNS=1)\n` +
          `Counterexample: ${describeCase(value)}\n${reason}`,
      );
    }
  }
}
