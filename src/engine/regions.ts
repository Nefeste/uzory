// Заливка связной области и «Где ещё?» (docs/08-game-design.md, «Управление»). Соседи —
// только по сторонам: по диагонали область не переходит, клетки канвы — граница.
import { CANVAS, type Pattern } from './pattern';

/**
 * Невышитые клетки той же нити, связанные с `start` по сторонам, в порядке обхода
 * в ширину (для «Как вышивалось» заливка расходится кругами). Если `start` не подходит —
 * пусто.
 */
export function fillRegion(p: Pattern, stitched: Uint8Array, start: number): number[] {
  if (start < 0 || start >= p.cells.length) return [];
  const t = p.cells[start];
  if (t === CANVAS || stitched[start]) return [];
  const seen = new Uint8Array(p.cells.length);
  const out: number[] = [start];
  seen[start] = 1;
  for (let head = 0; head < out.length; head++) {
    const i = out[head];
    const x = i % p.w, y = (i - x) / p.w;
    const push = (j: number) => {
      if (!seen[j] && p.cells[j] === t && !stitched[j]) { seen[j] = 1; out.push(j); }
    };
    if (x > 0) push(i - 1);
    if (x < p.w - 1) push(i + 1);
    if (y > 0) push(i - p.w);
    if (y < p.h - 1) push(i + p.w);
  }
  return out;
}

export interface Group {
  /** центр группы в клетках (дробный) */
  cx: number;
  cy: number;
  /** рамка группы, включительно */
  x0: number; y0: number; x1: number; y1: number;
  cells: number[];
}

/**
 * «Где ещё?»: связная группа невышитых клеток нити `thread`, чей центр ближе всего к точке
 * (x, y) в клетках — обычно к центру экрана. Нить закончена — null.
 */
export function nearestGroup(p: Pattern, stitched: Uint8Array, thread: number, x: number, y: number): Group | null {
  const seen = new Uint8Array(p.cells.length);
  let best: Group | null = null;
  let bestD = Infinity;
  for (let i = 0; i < p.cells.length; i++) {
    if (seen[i] || p.cells[i] !== thread || stitched[i]) continue;
    const cells = fillRegion(p, stitched, i);
    let sx = 0, sy = 0, x0 = p.w, y0 = p.h, x1 = -1, y1 = -1;
    for (const c of cells) {
      seen[c] = 1;
      const cx = c % p.w, cy = (c - cx) / p.w;
      sx += cx; sy += cy;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
    }
    const g: Group = { cx: sx / cells.length + 0.5, cy: sy / cells.length + 0.5, x0, y0, x1, y1, cells };
    const d = (g.cx - x) ** 2 + (g.cy - y) ** 2;
    if (d < bestD) { bestD = d; best = g; }
  }
  return best;
}

/** Следующая нить с оставшимися клетками после `thread` по кругу; все закончены — -1. */
export function nextThread(left: ArrayLike<number>, thread: number): number {
  const n = left.length;
  for (let k = 1; k <= n; k++) {
    const t = (thread + k) % n;
    if (left[t] > 0) return t;
  }
  return -1;
}
