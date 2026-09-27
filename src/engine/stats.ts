// Числа узора для проверок и листа превью (docs/09-content.md, §6): одиночные клетки,
// мелкие пятна, различимость нитей, связные области.
import { deltaOK, rgbToLab } from './color';
import { CANVAS, type Pattern } from './pattern';

export interface PatternStats {
  /** вышиваемых клеток */
  cells: number;
  /** доля клеток без соседа той же нити по сторонам, % */
  singles: number;
  /** доля клеток в связных областях до 3 клеток, % */
  small: number;
  /** связных областей одной нити */
  regions: number;
  /** наименьшее расстояние в OKLab между двумя нитями */
  minDelta: number;
  /** пара нитей с наименьшим расстоянием */
  closest: [number, number];
  /** нити, все клетки которых — одиночки */
  lonely: number[];
  /** клеток у каждой нити */
  counts: number[];
}

/**
 * `diagonal` — соседи и по диагонали: у нарисованных орнаментов косые линии в клетку —
 * замысел, а не «конфетти» (docs/09-content.md, §6).
 */
export function patternStats(p: Pattern, diagonal = false): PatternStats {
  const { w, h, cells } = p;
  const n = p.threads.length;
  const counts = new Array<number>(n).fill(0);
  const nonSingle = new Array<number>(n).fill(0);
  let total = 0;
  let singles = 0;
  for (let i = 0; i < cells.length; i++) {
    const t = cells[i];
    if (t === CANVAS) continue;
    total++;
    counts[t]++;
    const x = i % w;
    const y = (i - x) / w;
    let same = (x > 0 && cells[i - 1] === t) || (x < w - 1 && cells[i + 1] === t) || (y > 0 && cells[i - w] === t) || (y < h - 1 && cells[i + w] === t);
    if (!same && diagonal) {
      same = (x > 0 && y > 0 && cells[i - w - 1] === t) || (x < w - 1 && y > 0 && cells[i - w + 1] === t)
        || (x > 0 && y < h - 1 && cells[i + w - 1] === t) || (x < w - 1 && y < h - 1 && cells[i + w + 1] === t);
    }
    if (same) nonSingle[t]++;
    else singles++;
  }
  // связные области одной нити
  const comp = new Int32Array(cells.length).fill(-1);
  const stack: number[] = [];
  let regions = 0;
  let small = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === CANVAS || comp[i] >= 0) continue;
    const t = cells[i];
    let size = 0;
    stack.push(i);
    comp[i] = regions;
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      const x = j % w;
      const y = (j - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!diagonal && dx !== 0 && dy !== 0)) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (comp[k] < 0 && cells[k] === t) { comp[k] = regions; stack.push(k); }
        }
      }
    }
    if (size <= 3) small += size;
    regions++;
  }
  const labs = p.threads.map((t) => rgbToLab(t.rgb));
  let minDelta = Infinity;
  let closest: [number, number] = [0, 0];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const d = deltaOK(labs[a], labs[b]);
      if (d < minDelta) { minDelta = d; closest = [a, b]; }
    }
  }
  const lonely: number[] = [];
  for (let t = 0; t < n; t++) if (counts[t] > 0 && nonSingle[t] === 0) lonely.push(t);
  return {
    cells: total,
    singles: total ? (singles * 100) / total : 0,
    small: total ? (small * 100) / total : 0,
    regions,
    minDelta: n > 1 ? minDelta : Infinity,
    closest,
    lonely,
    counts,
  };
}
