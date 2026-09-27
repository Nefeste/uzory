// Узоры-образцы для замера канвы и тестов (docs/specs/2026-09-spikes.md, П2): области
// вокруг случайных центров — как у настоящих узоров, с номерами в каждой клетке.
import { labToRgb } from './color';
import type { Pattern } from './pattern';
import { pick, rng } from './seed';

export function samplePattern(seed: number, w: number, h: number, threads: number): Pattern {
  const r = rng(seed);
  // центры — по одному в квадрате со стороной √30 клеток, со случайным сдвигом: ближайший
  // центр ищется в квадратах на два вокруг (дальше он заведомо не ближе своего), и узор
  // в сотни тысяч клеток строится за доли секунды, а не за минуты полного перебора
  const step = Math.sqrt(30);
  const gw = Math.ceil(w / step);
  const gh = Math.ceil(h / step);
  const n = gw * gh;
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const st = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    sx[k] = ((k % gw) + r()) * step;
    sy[k] = (Math.floor(k / gw) + r()) * step;
    st[k] = k < threads ? k : pick(r, threads);
  }
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = Math.floor((y + 0.5) / step);
    for (let x = 0; x < w; x++) {
      const gx = Math.floor((x + 0.5) / step);
      let best = 0;
      let bd = Infinity;
      for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2); yy++) {
        for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
          const k = yy * gw + xx;
          const d = (sx[k] - x - 0.5) ** 2 + (sy[k] - y - 0.5) ** 2;
          if (d < bd) { bd = d; best = k; }
        }
      }
      cells[y * w + x] = st[best];
    }
  }
  // нить, чей центр не достался ни одной клетке, получает клетку своего центра
  for (let t = 0; t < Math.min(threads, n); t++) cells[Math.min(h - 1, Math.floor(sy[t])) * w + Math.min(w - 1, Math.floor(sx[t]))] = t;
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
