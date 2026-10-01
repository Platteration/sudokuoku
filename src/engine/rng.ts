/**
 * Small seeded PRNG (mulberry32). Deterministic seeds make a game
 * reproducible, which is handy for tests and for sharing a puzzle.
 */
export type Rng = () => number;

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

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export function randInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

/**
 * One of `items`, which must not be empty: no caller passes an empty list. An
 * Rng answers in [0, 1), so the index is always one of the list's own.
 */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randInt(rng, items.length)]!;
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1); // 0..i
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
