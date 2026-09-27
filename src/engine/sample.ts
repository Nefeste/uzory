// Узоры-образцы для замера канвы и тестов (docs/specs/2026-09-spikes.md, П2): области
// вокруг случайных центров — как у настоящих узоров, с номерами в каждой клетке.
import { labToRgb } from './color';
import type { Pattern } from './pattern';
import { pick, rng } from './seed';

export function samplePattern(seed: number, w: number, h: number, threads: number): Pattern {
  const r = rng(seed);
  const n = Math.max(threads, Math.round((w * h) / 30));
  const sx: number[] = [];
  const sy: number[] = [];
  const st: number[] = [];
  for (let i = 0; i < n; i++) {
    sx.push(r() * w);
    sy.push(r() * h);
    st.push(i < threads ? i : pick(r, threads));
  }
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (sx[i] - x - 0.5) ** 2 + (sy[i] - y - 0.5) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      cells[y * w + x] = st[best];
    }
  }
  // нить, чей центр не достался ни одной клетке, получает клетку своего центра
  for (let t = 0; t < threads; t++) cells[Math.min(h - 1, Math.floor(sy[t])) * w + Math.min(w - 1, Math.floor(sx[t]))] = t;
  const palette = Array.from({ length: threads }, (_, t) => {
    const hue = (t * 137.508 * Math.PI) / 180;
    const L = 0.35 + 0.55 * ((t * 7) % threads) / threads;
    return { rgb: labToRgb([L, 0.12 * Math.cos(hue), 0.12 * Math.sin(hue)]), name: `нить ${t + 1}` };
  });
  return { key: `sample-${w}x${h}-${threads}@${seed}`, w, h, threads: palette, cells };
}

/** Случайно вышитая доля узора — для замера «вышито на 50 %». */
export function sampleStitched(seed: number, p: Pattern, share: number): Uint8Array {
  const r = rng(seed);
  return Uint8Array.from(p.cells, () => (r() < share ? 1 : 0));
}

/** Работа кистью до конца: по каждой нити — строками, змейкой, штрихами по 30 клеток. */
export function sampleBrush(p: Pattern): { thread: number; cells: number[] }[] {
  const out: { thread: number; cells: number[] }[] = [];
  for (let t = 0; t < p.threads.length; t++) {
    for (let y = 0; y < p.h; y++) {
      const cells: number[] = [];
      for (let x = 0; x < p.w; x++) {
        const xx = y % 2 ? p.w - 1 - x : x;
        if (p.cells[y * p.w + xx] === t) cells.push(y * p.w + xx);
      }
      for (let i = 0; i < cells.length; i += 30) out.push({ thread: t, cells: cells.slice(i, i + 30) });
    }
  }
  return out;
}
