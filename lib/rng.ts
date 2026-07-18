// Seeded RNG (mulberry32) — the match engine and worldgen must be
// deterministic given a seed (GAME_DESIGN.md §2).

export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Derive a child seed so subsystems don't share RNG streams. */
export function deriveSeed(seed: number, label: string): number {
  return (hashString(label) ^ Math.imul(seed, 2654435761)) >>> 0;
}

export function randInt(rng: RNG, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function randRange(rng: RNG, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Approx normal via sum of uniforms (Irwin–Hall), mean 0, sd ~1. */
export function randNormal(rng: RNG): number {
  return (rng() + rng() + rng() + rng() + rng() + rng() - 3) / Math.sqrt(0.5);
}

export function pick<T>(rng: RNG, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function pickWeighted<T>(rng: RNG, items: readonly T[], weight: (t: T) => number): T {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return items[0];
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export function shuffle<T>(rng: RNG, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Poisson sample (Knuth) — used for chance counts per segment. */
export function randPoisson(rng: RNG, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

let uidCounter = 0;
/** Non-random unique id helper for entities created during play. */
export function uid(prefix: string): string {
  uidCounter = (uidCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}`;
}
