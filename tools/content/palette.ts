// Сетка цветов → узор (docs/specs/2026-09-content-pipeline.md, шаги 5–11): палитра
// k-средних в OKLab, слияние похожих нитей, назначение без дизеринга, чистка мелких
// пятен, порядок «как нитки в коробке». Детерминированно: случайность — из зерна id.
import { deltaOK, labToLch, labToRgb, type Lab, linearToLab, rgbToLab } from '../../src/engine/color';
import { CANVAS, type Pattern, type SizeClass } from '../../src/engine/pattern';
import { hash32, rng } from '../../src/engine/seed';
import type { Grid } from './image';
import { nameThreads } from './names';

/**
 * Пороги различимости нитей по размеру (docs/09-content.md, §6). Средний и большой снижены
 * 27.09.2026 (было 0,065 и 0,05): при старых из 32 заказанных нитей у картин оставалось 9–16,
 * узор выходил тусклым, а мелкие цветные пятна (лица, белка на стволе) сливались с фоном.
 */
export const MIN_DELTA: Record<SizeClass, number> = { S: 0.08, M: 0.045, L: 0.03, XL: 0.025 };
export const KMEANS_ITERS = 30;
export const CLEAN_PASSES = 6;
export const SMALL_REGION = 3;

export interface BuildOptions {
  id: string;
  v: number;
  threads: number;
  /** цвет фона, который остаётся невышитым (ботанические иллюстрации) */
  canvas?: number;
  /** порог «близко к фону» в OKLab */
  canvasDelta?: number;
  /** порог различимости вместо MIN_DELTA — для листа вариантов П3 */
  minDelta?: number;
}

export interface BuildLog {
  asked: number;
  afterKmeans: number;
  afterMerge: number;
  final: number;
  singlesBefore: number;
  smallBefore: number;
}

function sizeOf(n: number): SizeClass {
  return n <= 1600 ? 'S' : n <= 4900 ? 'M' : n <= 14400 ? 'L' : 'XL';
}

function nearest(c: Lab, centers: Lab[]): number {
  let best = 0;
  let bd = Infinity;
  for (let k = 0; k < centers.length; k++) {
    const dl = c[0] - centers[k][0];
    const da = c[1] - centers[k][1];
    const db = c[2] - centers[k][2];
    const d = dl * dl + da * da + db * db;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** k-means++ с зерном и не больше KMEANS_ITERS итераций Ллойда. */
export function kmeans(points: Lab[], k: number, seed: number): Lab[] {
  const r = rng(seed);
  const n = points.length;
  if (n === 0) return [];
  const centers: Lab[] = [points[Math.floor(r() * n)]];
  const d2 = new Float64Array(n).fill(Infinity);
  while (centers.length < Math.min(k, n)) {
    const last = centers[centers.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = deltaOK(points[i], last) ** 2;
      if (d < d2[i]) d2[i] = d;
      sum += d2[i];
    }
    if (sum === 0) break;
    let t = r() * sum;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      t -= d2[i];
      if (t <= 0) { pick = i; break; }
    }
    centers.push(points[pick]);
  }
  const assign = new Int32Array(n).fill(-1);
  for (let it = 0; it < KMEANS_ITERS; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const a = nearest(points[i], centers);
      if (a !== assign[i]) { assign[i] = a; moved++; }
    }
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sum[assign[i]];
      s[0] += points[i][0]; s[1] += points[i][1]; s[2] += points[i][2]; s[3]++;
    }
    for (let c = 0; c < centers.length; c++) if (sum[c][3]) centers[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
    if (!moved) break;
  }
  return centers;
}

/**
 * Сливает нити ближе порога, взвешенно по числу клеток, пока такие есть. `map[k]` — куда
 * ушла прежняя нить k: клетки переназначаются по нему, а не заново по цвету, чтобы не
 * вернуть «конфетти», убранное чисткой.
 */
function mergeClose(centers: Lab[], weights: number[], min: number): { centers: Lab[]; weights: number[]; map: number[] } {
  const c = centers.map((x) => [...x] as Lab);
  const w = [...weights];
  let map = centers.map((_, k) => k);
  for (;;) {
    let best = Infinity;
    let pa = -1;
    let pb = -1;
    for (let a = 0; a < c.length; a++) for (let b = a + 1; b < c.length; b++) {
      const d = deltaOK(c[a], c[b]);
      if (d < best) { best = d; pa = a; pb = b; }
    }
    if (pa < 0 || best >= min) break;
    const t = w[pa] + w[pb] || 1;
    c[pa] = [0, 1, 2].map((k) => (c[pa][k] * w[pa] + c[pb][k] * w[pb]) / t) as Lab;
    w[pa] = w[pa] + w[pb];
    c.splice(pb, 1);
    w.splice(pb, 1);
    map = map.map((m) => (m === pb ? pa : m > pb ? m - 1 : m));
  }
  return { centers: c, weights: w, map };
}

/** Связные области одной нити (соседи по сторонам): номер области на клетку и размеры. */
export function regions(cells: Int32Array, w: number, h: number): { comp: Int32Array; sizes: number[] } {
  const comp = new Int32Array(cells.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] < 0 || comp[i] >= 0) continue;
    const t = cells[i];
    const id = sizes.length;
    let size = 0;
    comp[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      const x = j % w;
      const y = (j - x) / w;
      const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1];
      for (const k of nb) if (k >= 0 && comp[k] < 0 && cells[k] === t) { comp[k] = id; stack.push(k); }
    }
    sizes.push(size);
  }
  return { comp, sizes };
}

/**
 * Чистка: область меньше SMALL_REGION клеток перекрашивается в соседнюю нить с самой
 * длинной общей границей; до CLEAN_PASSES проходов. −1 в клетках — канва, её не трогаем.
 */
export function cleanup(cells: Int32Array, w: number, h: number): boolean {
  let changed = false;
  for (let pass = 0; pass < CLEAN_PASSES; pass++) {
    const { comp, sizes } = regions(cells, w, h);
    const border = new Map<number, Map<number, number>>();
    for (let i = 0; i < cells.length; i++) {
      const c = comp[i];
      if (c < 0 || sizes[c] >= SMALL_REGION) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (const k of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (k < 0 || cells[k] < 0 || cells[k] === cells[i]) continue;
        const m = border.get(c) ?? new Map<number, number>();
        m.set(cells[k], (m.get(cells[k]) ?? 0) + 1);
        border.set(c, m);
      }
    }
    if (!border.size) return changed;
    changed = true;
    const target = new Map<number, number>();
    for (const [c, m] of border) {
      let best = -1;
      let bn = -1;
      // равная граница — меньший номер нити: порядок обхода не влияет на результат
      for (const [t, n] of [...m].sort((a, b) => a[0] - b[0])) if (n > bn) { bn = n; best = t; }
      target.set(c, best);
    }
    for (let i = 0; i < cells.length; i++) {
      const t = target.get(comp[i]);
      if (t !== undefined) cells[i] = t;
    }
  }
  return changed;
}

/** Порядок «как нитки в коробке»: почти серые, затем 12 секторов оттенка, светлые раньше. */
export function boxOrder(labs: Lab[]): number[] {
  const key = labs.map((lab, i) => {
    const [L, C, H] = labToLch(lab);
    const sector = C < 0.03 ? -1 : Math.floor(((H + 15) % 360) / 30);
    return { i, sector, L };
  });
  key.sort((a, b) => a.sector - b.sector || b.L - a.L || a.i - b.i);
  return key.map((k) => k.i);
}

/** Собирает узор из сетки. */
export function buildPattern(g: Grid, o: BuildOptions): { pattern: Pattern; log: BuildLog } {
  const n = g.w * g.h;
  const labs: Lab[] = new Array(n);
  for (let i = 0; i < n; i++) labs[i] = linearToLab(g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2]);
  // канва: клетки близко к объявленному фону остаются невышитыми
  const cells = new Int32Array(n);
  const bg = o.canvas !== undefined ? rgbToLab(o.canvas) : null;
  const stitchIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (bg && deltaOK(labs[i], bg) < (o.canvasDelta ?? 0.06)) cells[i] = -1;
    else stitchIdx.push(i);
  }
  const size = sizeOf(stitchIdx.length);
  const min = o.minDelta ?? MIN_DELTA[size];
  const pts = stitchIdx.map((i) => labs[i]);
  let centers = kmeans(pts, o.threads, hash32(o.id));
  const log: BuildLog = { asked: o.threads, afterKmeans: centers.length, afterMerge: 0, final: 0, singlesBefore: 0, smallBefore: 0 };
  const assignAll = () => { for (const i of stitchIdx) cells[i] = nearest(labs[i], centers); };
  const weights = () => {
    const wt = centers.map(() => 0);
    for (const i of stitchIdx) wt[cells[i]]++;
    return wt;
  };
  assignAll();
  const remap = (map: number[]) => { for (const i of stitchIdx) cells[i] = map[cells[i]]; };
  {
    const m = mergeClose(centers, weights(), min);
    centers = m.centers;
    remap(m.map);
  }
  log.afterMerge = centers.length;
  {
    const { sizes } = regions(cells, g.w, g.h);
    let small = 0;
    let singles = 0;
    for (const s of sizes) { if (s <= SMALL_REGION) small += s; if (s === 1) singles++; }
    log.singlesBefore = (singles * 100) / Math.max(1, stitchIdx.length);
    log.smallBefore = (small * 100) / Math.max(1, stitchIdx.length);
  }
  const minCells = Math.max(8, Math.ceil(stitchIdx.length * 0.002));
  // Чистка, слияние маленьких нитей, пересчёт цветов и различимость — пока что-то меняется.
  // Цвета сразу округляются до sRGB: различимость проверяется у тех цветов, что уйдут в набор.
  for (let round = 0; round < 8; round++) {
    let changed = cleanup(cells, g.w, g.h);
    let wt = weights();
    for (;;) {
      let worst = -1;
      for (let k = 0; k < centers.length; k++) if (wt[k] < minCells && (worst < 0 || wt[k] < wt[worst])) worst = k;
      if (worst < 0 || centers.length < 2) break;
      const others = centers.map((c, k) => (k === worst ? [1e9, 1e9, 1e9] as Lab : c));
      const to = nearest(centers[worst], others);
      remap(centers.map((_, k) => (k === worst ? (to > worst ? to - 1 : to) : k > worst ? k - 1 : k)));
      centers.splice(worst, 1);
      wt = weights();
      changed = true;
    }
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const i of stitchIdx) {
      const s = sum[cells[i]];
      s[0] += labs[i][0]; s[1] += labs[i][1]; s[2] += labs[i][2]; s[3]++;
    }
    centers = centers.map((c, k) => (sum[k][3] ? rgbToLab(labToRgb([sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]])) : c));
    const m = mergeClose(centers, weights(), min);
    if (m.centers.length !== centers.length) {
      centers = m.centers.map((c) => rgbToLab(labToRgb(c)));
      remap(m.map);
      changed = true;
    }
    if (!changed) break;
  }
  // палитра в sRGB, порядок коробки, названия
  const rgbs = centers.map((c) => labToRgb(c));
  const order = boxOrder(centers.map((_, k) => rgbToLab(rgbs[k])));
  const place = new Int32Array(centers.length);
  order.forEach((old, neu) => (place[old] = neu));
  const palette = order.map((k) => rgbs[k]);
  const names = nameThreads(palette);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = cells[i] < 0 ? CANVAS : place[cells[i]];
  log.final = palette.length;
  return {
    pattern: { key: `${o.id}@${o.v}`, w: g.w, h: g.h, threads: palette.map((rgb, k) => ({ rgb, name: names[k] })), cells: out },
    log,
  };
}
