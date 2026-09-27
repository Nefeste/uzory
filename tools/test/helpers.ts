// Узоры и работы для тестов — из зерна, одинаковые на любой машине.
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { pick, rng } from '../../src/engine/seed';
import type { Stroke } from '../../src/engine/work';

/** Узор пятнами: соседние клетки часто одной нити, как у настоящих узоров. */
export function randomPattern(seed: number, w: number, h: number, threads: number, canvasShare = 0): Pattern {
  const r = rng(seed);
  const cells = new Uint8Array(w * h);
  for (let i = 0; i < cells.length; i++) {
    const x = i % w;
    if (r() < canvasShare) cells[i] = CANVAS;
    else if (x > 0 && r() < 0.6) cells[i] = cells[i - 1];
    else if (i >= w && r() < 0.5) cells[i] = cells[i - w];
    else cells[i] = pick(r, threads);
  }
  // каждая нить встречается хотя бы раз
  for (let t = 0; t < threads; t++) cells[(t * 7919) % cells.length] = t;
  return {
    key: `test-${seed}@1`,
    w,
    h,
    threads: Array.from({ length: threads }, (_, t) => ({ rgb: (t * 0x3b5f1d) & 0xffffff, name: `нить-${t}` })),
    cells,
  };
}

/** Штрихи вперемешку: касания, проходы кистью (соседние клетки), мусор — чужие и повторные. */
export function randomStrokes(seed: number, p: Pattern, count: number): Stroke[] {
  const r = rng(seed);
  const out: Stroke[] = [];
  for (let k = 0; k < count; k++) {
    const thread = pick(r, p.threads.length);
    const n = 1 + pick(r, 40);
    let c = pick(r, p.w * p.h);
    const cells: number[] = [c];
    for (let i = 1; i < n; i++) {
      const d = [1, -1, p.w, -p.w][pick(r, 4)];
      const next = c + d;
      if (next >= 0 && next < p.w * p.h) c = next;
      cells.push(c);
    }
    out.push({ thread, cells });
  }
  return out;
}

/** Работа кистью до конца: по каждой нити — строками, как водит палец. */
export function brushAll(p: Pattern): Stroke[] {
  const out: Stroke[] = [];
  for (let t = 0; t < p.threads.length; t++) {
    for (let y = 0; y < p.h; y++) {
      const cells: number[] = [];
      for (let x = 0; x < p.w; x++) {
        const xx = y % 2 ? p.w - 1 - x : x; // змейкой
        if (p.cells[y * p.w + xx] === t) cells.push(y * p.w + xx);
      }
      for (let i = 0; i < cells.length; i += 30) out.push({ thread: t, cells: cells.slice(i, i + 30) });
    }
  }
  return out;
}
