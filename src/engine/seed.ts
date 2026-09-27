// Случайность из зерна: движок не зовёт `Math.random()` (ADR 0010, docs/06-testing.md) —
// сборка картинок, тесты и замер получают одинаковые числа на любой машине.

/** FNV-1a, 32 бита: строка → зерно. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: числа в [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Целое в [0, n). */
export const pick = (r: () => number, n: number) => Math.floor(r() * n);
