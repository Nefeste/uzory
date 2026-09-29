// Старинная схема на бумаге → сетка цветов (docs/specs/2026-09-schemes.md; карточка — docs/09-content.md, §4).
//
// Схему рисовали на бумаге в клетку и раскрашивали клетки от руки; краска перекрывает
// линии, а внутри клетки цвет ровный. Поэтому линии сетки видны по перепадам цвета (на
// самих линиях и на границах разноцветных клеток) и по темноте (линия темнее бумаги по
// обе стороны). Скан бывает чуть повёрнут; бумага растянута неравномерно, и ровная сетка
// к дальнему краю уходит от настоящей на клетку; большие схемы склеены из листов, а сетка
// отпечатана блоками — на стыке она сдвинута на полклетки. Поэтому сборка ищет линии в три
// шага: общий шаг и наклон по всему листу → места всех линий сразу, с шагами около общего →
// у каждого столбца и строки клеток — свои места линий по полосе в несколько клеток вокруг.
// Цвет клетки — середина четырёхугольника между линиями, без самих линий.
//
//   bun tools/content/chart.ts <файл> <слева,сверху,справа,снизу>
//   → число клеток, шаг, наклон и цвет бумаги для карточки (pattern.chart, cells, canvas)
import sharp from 'sharp';
import { deltaOK, type Lab, labToLinear, linear, linearToLab, rgbToLab } from '../../src/engine/color';
import type { Grid, Raster } from './image';

/**
 * Найденная сетка. Линия задана местом у середины рамки и общим наклоном: вертикальная —
 * x = a + sx · (y − yc), горизонтальная — y = a + sy · (x − xc).
 */
export interface ChartGrid {
  /** вертикальные линии по всему листу: w + 1 линий */
  xs: number[];
  /** горизонтальные линии по всему листу: h + 1 линий */
  ys: number[];
  /** вертикальные линии у каждой строки клеток: byRow[j][i] */
  byRow: number[][];
  /** горизонтальные линии у каждого столбца клеток: byCol[i][j] */
  byCol: number[][];
  /** наклон вертикальных линий: dx/dy; горизонтальных: dy/dx */
  sx: number;
  sy: number;
  xc: number;
  yc: number;
  /** шаг, точек; самоподобие профиля 0…1 — насколько сетка явная */
  pitch: [number, number];
  score: [number, number];
}

/** Клетки схемы: цвет середины и насколько видна сетка (sampleChart). */
export interface ChartCells extends Grid {
  /**
   * насколько края клетки темнее её середины (0 — ровная, 0,2 — на 20 %): меньшее из «слева и
   * справа» и «сверху и снизу». На бумаге без краски линии сетки видны со всех сторон; краска
   * их закрывает; у поля рядом с сеткой линия только с одной стороны
   */
  lines: Float64Array;
}

/** Перепад цвета к соседу справа (dir 0) или снизу (dir 1): сумма по трём каналам. */
function edges(r: Raster, dir: 0 | 1): Float32Array {
  const out = new Float32Array(r.width * r.height);
  const step = dir === 0 ? 3 : r.width * 3;
  for (let y = 0; y < r.height - dir; y++) {
    for (let x = 0; x < r.width - (1 - dir); x++) {
      const o = (y * r.width + x) * 3;
      out[y * r.width + x] = Math.abs(r.data[o] - r.data[o + step]) + Math.abs(r.data[o + 1] - r.data[o + step + 1]) + Math.abs(r.data[o + 2] - r.data[o + step + 2]);
    }
  }
  return out;
}

/** Шаг по профилю: наименьший лаг с высокой самоподобностью, без медленного фона. */
function pitchOf(raw: Float64Array, minLag = 4, maxLag = 80): { lag: number; score: number } {
  const n = raw.length;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - maxLag); j <= Math.min(n - 1, i + maxLag); j++) {
      s += raw[j];
      c++;
    }
    d[i] = raw[i] - s / c;
  }
  const auto = (lag: number) => {
    let s = 0, a = 0, b = 0;
    for (let i = 0; i + lag < n; i++) {
      s += d[i] * d[i + lag];
      a += d[i] * d[i];
      b += d[i + lag] * d[i + lag];
    }
    return s / Math.sqrt(a * b || 1);
  };
  const top = Math.min(maxLag, n - 2);
  const vals: number[] = [];
  for (let lag = 0; lag <= top; lag++) vals.push(lag < minLag ? -1 : auto(lag));
  let best = minLag;
  for (let lag = minLag; lag <= top; lag++) if (vals[lag] > vals[best]) best = lag;
  // кратные шагу лаги подобны почти так же: берём наименьший пик рядом с лучшим
  for (let lag = minLag + 1; lag < top; lag++) {
    if (vals[lag] >= vals[lag - 1] && vals[lag] >= vals[lag + 1] && vals[lag] >= 0.85 * vals[best]) {
      best = lag;
      break;
    }
  }
  // дробный шаг — по параболе через соседей пика
  const a = vals[best - 1], b = vals[best], c = vals[best + 1] ?? b;
  const den = a - 2 * b + c;
  return { lag: den < 0 ? best + (0.5 * (a - c)) / den : best, score: b };
}

/** Яркость точки 0…255: линии сетки темнее бумаги. */
function brightness(r: Raster): Float32Array {
  const out = new Float32Array(r.width * r.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * r.data[i * 3] + 0.587 * r.data[i * 3 + 1] + 0.114 * r.data[i * 3 + 2];
  return out;
}

/** Шаг поиска места линии, точек. */
const STEP = 0.25;
/** Штраф за шаг между соседними линиями не как общий: (шаг / общий − 1)² · STRETCH. */
const STRETCH = 16;
/** Полоса для своих мест линий: столько клеток в каждую сторону. */
const BAND = 4;
/** Штраф за уход своего места линии от общего: (сдвиг / шаг)² · SHIFT. */
const SHIFT = 4;

/**
 * Линии одного направления. u — поперёк линий, t — вдоль; линия u = a + s · (t − tc).
 * `e` — перепады поперёк линий, `y` — яркость.
 */
class Lines {
  constructor(
    private e: Float32Array,
    private y: Float32Array,
    private W: number,
    private H: number,
    private vertical: boolean,
    private tc: number,
  ) {}

  /** среднее по линии на отрезке [tLo, tHi); вдоль — каждая `stride`-я точка */
  along(m: Float32Array, a: number, s: number, tLo: number, tHi: number, stride = 2): number {
    const uMax = (this.vertical ? this.W : this.H) - 2;
    const tEnd = Math.min(tHi, this.vertical ? this.H : this.W);
    let sum = 0, n = 0;
    for (let t = Math.max(0, Math.round(tLo)); t < tEnd; t += stride) {
      const u = a + s * (t - this.tc);
      if (u < 0 || u > uMax) continue;
      const i = Math.floor(u);
      const f = u - i;
      sum += this.vertical ? m[t * this.W + i] * (1 - f) + m[t * this.W + i + 1] * f : m[i * this.W + t] * (1 - f) + m[(i + 1) * this.W + t] * f;
      n++;
    }
    return n ? sum / n : 0;
  }

  /**
   * Профиль «здесь линия» с шагом STEP от u0: перепады плюс темнота относительно полушага по
   * обе стороны. Темнота нужна для толстых линий: у них два края, и по одним перепадам
   * середина клетки между краями соседних линий не хуже самой линии. Оба слагаемых — в
   * единицах разброса `norm`; без него разброс считается по самому профилю.
   */
  profile(u0: number, m: number, pitch: number, s: number, tLo: number, tHi: number, norm?: Norm): { z: Float64Array; norm: Norm } {
    const half = Math.round(pitch / 2 / STEP);
    const yb = new Float64Array(m + 2 * half);
    for (let i = 0; i < yb.length; i++) yb[i] = this.along(this.y, u0 + (i - half) * STEP, s, tLo, tHi);
    const pe = new Float64Array(m);
    const pd = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      pe[i] = this.along(this.e, u0 + i * STEP, s, tLo, tHi);
      pd[i] = (yb[i] + yb[i + 2 * half]) / 2 - yb[i + half];
    }
    const stat = (v: Float64Array): [number, number] => {
      let mean = 0;
      for (let i = 0; i < m; i++) mean += v[i];
      mean /= m;
      let sd = 0;
      for (let i = 0; i < m; i++) sd += (v[i] - mean) ** 2;
      return [mean, Math.sqrt(sd / m) || 1];
    };
    const nn = norm ?? { edge: stat(pe), dark: stat(pd) };
    const z = new Float64Array(m);
    for (let i = 0; i < m; i++) z[i] = (pe[i] - nn.edge[0]) / nn.edge[1] + (pd[i] - nn.dark[0]) / nn.dark[1];
    return { z, norm: nn };
  }
}

interface Norm {
  edge: [number, number];
  dark: [number, number];
}

/**
 * Общий проход: шаг — по самоподобию профиля перепадов; наклон и сдвиг ровной сетки — при
 * которых линии сильнее всего; затем места всех линий сразу (динамическое программирование):
 * профиль «здесь линия» как можно выше при шагах, близких к общему.
 */
function globalLines(L: Lines, e: Float32Array, lo: number, hi: number, tLo: number, tHi: number): { pos: number[]; s: number; pitch: number; score: number; norm: Norm } {
  const prof = new Float64Array(hi - lo);
  for (let u = lo; u < hi; u++) prof[u - lo] = L.along(e, u, 0, tLo, tHi);
  const { lag: pitch, score } = pitchOf(prof);
  // наклон до ±1,2°: сначала грубо, потом точнее около лучшего. Для наклона — профиль
  // перепадов через полточки, вдоль линии — каждая четвёртая точка; сдвиг ровной сетки —
  // лучший по этому профилю
  const half = Math.ceil((hi - lo) * 2);
  const tryS = (s: number) => {
    const p = new Float64Array(half);
    for (let i = 0; i < half; i++) p[i] = L.along(e, lo + i / 2, s, tLo, tHi, 4);
    let bestE = -Infinity;
    for (let off = 0; off < pitch; off += 0.5) {
      let sum = 0, n = 0;
      for (let a = off; a < hi - lo; a += pitch) {
        sum += p[Math.min(half - 1, Math.round(a * 2))];
        n++;
      }
      if (n && sum / n > bestE) bestE = sum / n;
    }
    return bestE;
  };
  let best = { s: 0, e: -Infinity };
  for (let s = -0.021; s <= 0.0211; s += 0.0015) {
    const en = tryS(s);
    if (en > best.e) best = { s, e: en };
  }
  const coarse = best.s;
  for (let s = coarse - 0.00125; s <= coarse + 0.00126; s += 0.00025) {
    const en = tryS(s);
    if (en > best.e) best = { s, e: en };
  }
  // первая линия — ближняя к краю рамки, последняя — к другому краю; число линий — какое выйдет
  const u0 = lo - pitch / 2 - 1;
  const m = Math.ceil((hi - lo + pitch + 2) / STEP) + 1;
  const { z, norm } = L.profile(u0, m, pitch, best.s, tLo, tHi);
  const dMin = Math.floor((0.75 * pitch) / STEP);
  const dMax = Math.ceil((1.25 * pitch) / STEP);
  const pen = new Float64Array(dMax + 1);
  for (let d = dMin; d <= dMax; d++) pen[d] = STRETCH * ((d * STEP) / pitch - 1) ** 2;
  const edge = Math.ceil((pitch + 2) / STEP);
  const sc = new Float64Array(m).fill(-Infinity);
  const from = new Int32Array(m).fill(-1);
  for (let i = 0; i < m; i++) {
    if (i <= edge) sc[i] = z[i];
    for (let d = dMin; d <= dMax && d <= i; d++) {
      const v = sc[i - d] - pen[d] + z[i];
      if (v > sc[i]) { sc[i] = v; from[i] = i - d; }
    }
  }
  let end = m - 1;
  for (let i = m - 1 - edge; i < m; i++) if (sc[i] > sc[end]) end = i;
  const idx = [end];
  while (from[idx[idx.length - 1]] >= 0) idx.push(from[idx[idx.length - 1]]);
  return { pos: idx.reverse().map((i) => u0 + i * STEP), s: best.s, pitch, score, norm };
}

/**
 * Свои места линий на отрезке [tLo, tHi) вдоль них: около общих `prior`, не дальше 0,6 шага.
 * Сдвиг от общего места штрафуется, как и разница сдвигов соседних линий: на стыке листов
 * сдвинута вся полоса сразу, а не одна линия.
 */
function localLines(L: Lines, prior: number[], pitch: number, s: number, tLo: number, tHi: number, norm: Norm): { pos: number[] } {
  const R = Math.round((0.6 * pitch) / STEP);
  const C = 2 * R + 1;
  const D = Math.floor((0.25 * pitch) / STEP);
  const u0 = prior[0] - R * STEP - 1;
  const m = Math.ceil((prior[prior.length - 1] + R * STEP + 1 - u0) / STEP) + 1;
  const { z } = L.profile(u0, m, pitch, s, tLo, tHi, norm);
  const zAt = (u: number) => z[Math.min(m - 1, Math.max(0, Math.round((u - u0) / STEP)))];
  const shift = new Float64Array(C);
  for (let c = 0; c < C; c++) shift[c] = SHIFT * (((c - R) * STEP) / pitch) ** 2;
  let sc = new Float64Array(C);
  for (let c = 0; c < C; c++) sc[c] = zAt(prior[0] + (c - R) * STEP) - shift[c];
  const back: Int32Array[] = [];
  for (let k = 1; k < prior.length; k++) {
    const next = new Float64Array(C);
    const from = new Int32Array(C);
    for (let c = 0; c < C; c++) {
      let bs = -Infinity, bq = 0;
      // шаг между линиями — не дальше четверти от общего, как в общем проходе
      for (let q = Math.max(0, c - D); q <= Math.min(C - 1, c + D); q++) {
        const v = sc[q] - STRETCH * (((c - q) * STEP) / pitch) ** 2;
        if (v > bs) { bs = v; bq = q; }
      }
      next[c] = bs + zAt(prior[k] + (c - R) * STEP) - shift[c];
      from[c] = bq;
    }
    back.push(from);
    sc = next;
  }
  let end = 0;
  for (let c = 1; c < C; c++) if (sc[c] > sc[end]) end = c;
  const cs = [end];
  for (let k = back.length - 1; k >= 0; k--) cs.push(back[k][cs[cs.length - 1]]);
  cs.reverse();
  return { pos: prior.map((a, k) => a + (cs[k] - R) * STEP) };
}

/**
 * Сетка схемы внутри рамки `rect` (доли кадра: слева, сверху, справа, снизу). Рамка — чуть
 * шире разлинованной сетки, по полю вокруг неё, но не по толстой линии обрамления: крайние
 * линии сборка находит у краёв рамки, а поле без сетки потом отрезает (trimMargins).
 */
export function detectChart(r: Raster, rect: [number, number, number, number]): ChartGrid {
  const [l, t, rr, b] = rect;
  const x0 = Math.round(l * r.width), x1 = Math.round(rr * r.width);
  const y0 = Math.round(t * r.height), y1 = Math.round(b * r.height);
  const xc = (x0 + x1) / 2, yc = (y0 + y1) / 2;
  const y = brightness(r);
  const ev = edges(r, 0);
  const eh = edges(r, 1);
  const V = new Lines(ev, y, r.width, r.height, true, yc);
  const H = new Lines(eh, y, r.width, r.height, false, xc);
  const v = globalLines(V, ev, x0, x1, y0, y1);
  const h = globalLines(H, eh, y0, y1, x0, x1);
  const w = v.pos.length - 1;
  const hh = h.pos.length - 1;
  // свои линии у каждого столбца — по полосе в 2·BAND + 1 клеток: вокруг него, слева или
  // справа. У шва склейки полоса вокруг захватывает оба листа, а полоса со стороны столбца —
  // только его лист; какая из трёх — решают линии самого столбца
  const own = (L: Lines, prior: number[], pitch: number, s: number, norm: Norm, across: number[], bands: Map<number, number[]>, i: number) => {
    const n = across.length - 1;
    const tried = new Set<number>();
    const u0 = prior[0] - pitch;
    const m = Math.ceil((prior[prior.length - 1] + pitch - u0) / STEP) + 1;
    const { z } = L.profile(u0, m, pitch, s, across[i], across[i + 1], norm);
    const fit = (pos: number[]) => pos.reduce((sum, u) => sum + z[Math.min(m - 1, Math.max(0, Math.round((u - u0) / STEP)))], 0);
    let best: number[] | null = null;
    let bestFit = -Infinity;
    for (const a of [i - BAND, i - 2 * BAND, i]) {
      const lo = Math.max(0, Math.min(a, n - 2 * BAND - 1));
      if (tried.has(lo)) continue;
      tried.add(lo);
      // полоса одна на несколько столбцов: считается один раз
      let pos = bands.get(lo);
      if (!pos) {
        pos = localLines(L, prior, pitch, s, across[lo], across[Math.min(n, lo + 2 * BAND + 1)], norm).pos;
        bands.set(lo, pos);
      }
      const f = fit(pos);
      if (f > bestFit) { bestFit = f; best = pos; }
    }
    return best!;
  };
  const colBands = new Map<number, number[]>();
  const byCol = Array.from({ length: w }, (_, i) => own(H, h.pos, h.pitch, h.s, h.norm, v.pos, colBands, i));
  const rowBands = new Map<number, number[]>();
  const byRow = Array.from({ length: hh }, (_, j) => own(V, v.pos, v.pitch, v.s, v.norm, h.pos, rowBands, j));
  const g: ChartGrid = { xs: v.pos, ys: h.pos, byRow, byCol, sx: v.s, sy: h.s, xc, yc, pitch: [v.pitch, h.pitch], score: [v.score, h.score] };
  return trimMargins(g, sampleChart(r, g, 0.25));
}

/** Клетки без краски: сетка видна (линии темнят клетку хотя бы на столько). */
export const RULED = 0.1;
/** Клетка поля: сетки нет (темнее середины меньше чем на столько), а цвет — как у бумаги. */
const BARE = 0.05;

/**
 * Отрезает поле без сетки у краёв: столбцы и строки, где больше половины клеток — бумага без
 * линий. Цвет бумаги — медиана клеток с видной сеткой; если таких мало, резать нечего.
 */
function trimMargins(g: ChartGrid, grid: ChartCells): ChartGrid {
  const { w, h, rgb, lines } = grid;
  const paper: Lab[] = [];
  for (let i = 0; i < w * h; i++) if (lines[i] >= RULED) paper.push(linearToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]));
  if (paper.length < 0.05 * w * h) return g;
  const med = (k: number) => paper.map((c) => c[k]).sort((a, b) => a - b)[Math.floor(paper.length / 2)];
  const bg: Lab = [med(0), med(1), med(2)];
  const bare = (x: number, y: number) => {
    const i = y * w + x;
    return lines[i] < BARE && deltaOK(linearToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]), bg) < 0.15;
  };
  let [x0, y0, x1, y1] = [0, 0, w, h];
  const colBare = (x: number) => { let n = 0; for (let y = y0; y < y1; y++) n += +bare(x, y); return n > (y1 - y0) / 2; };
  const rowBare = (y: number) => { let n = 0; for (let x = x0; x < x1; x++) n += +bare(x, y); return n > (x1 - x0) / 2; };
  for (let changed = true; changed && x1 - x0 > 2 && y1 - y0 > 2; ) {
    changed = false;
    if (colBare(x0)) { x0++; changed = true; }
    if (colBare(x1 - 1)) { x1--; changed = true; }
    if (rowBare(y0)) { y0++; changed = true; }
    if (rowBare(y1 - 1)) { y1--; changed = true; }
  }
  if (x0 === 0 && y0 === 0 && x1 === w && y1 === h) return g;
  return {
    ...g,
    xs: g.xs.slice(x0, x1 + 1),
    ys: g.ys.slice(y0, y1 + 1),
    byRow: g.byRow.slice(y0, y1).map((xs) => xs.slice(x0, x1 + 1)),
    byCol: g.byCol.slice(x0, x1).map((ys) => ys.slice(y0, y1 + 1)),
  };
}

/** Веса точек для отрезка [a, b): какие точки и какой долей входят. */
function spans(a: number, b: number): { i: number; w: number }[] {
  const out: { i: number; w: number }[] = [];
  for (let i = Math.floor(a); i < Math.ceil(b); i++) {
    const w = Math.min(b, i + 1) - Math.max(a, i);
    if (w > 1e-9) out.push({ i, w });
  }
  return out;
}

/**
 * Клетки схемы → сетка цветов: середина каждой клетки без доли `inset` с краёв. `lines` —
 * насколько края клетки темнее середины: слева и справа вместе, сверху и снизу вместе — и
 * меньшее из двух. У бумаги без краски сетка видна со всех сторон, у поля рядом с сеткой —
 * с одной.
 */
export function sampleChart(r: Raster, g: ChartGrid, inset: number): ChartCells {
  const w = g.xs.length - 1;
  const h = g.ys.length - 1;
  const rgb = new Float64Array(w * h * 3);
  const lines = new Float64Array(w * h);
  const lum = (o: number) => 0.2126 * linear(r.data[o]) + 0.7152 * linear(r.data[o + 1]) + 0.0722 * linear(r.data[o + 2]);
  /** среднее по прямоугольнику [x0, x1) × [y0, y1): цвет и яркость */
  const box = (x0: number, x1: number, y0: number, y1: number) => {
    let sr = 0, sg = 0, sb = 0, sy = 0, sw = 0;
    for (const ry of spans(Math.max(0, y0), Math.min(r.height, y1))) {
      for (const rx of spans(Math.max(0, x0), Math.min(r.width, x1))) {
        const q = ry.w * rx.w;
        const o = (ry.i * r.width + rx.i) * 3;
        sr += linear(r.data[o]) * q;
        sg += linear(r.data[o + 1]) * q;
        sb += linear(r.data[o + 2]) * q;
        sy += lum(o) * q;
        sw += q;
      }
    }
    return { r: sr / sw, g: sg / sw, b: sb / sw, y: sy / sw };
  };
  for (let j = 0; j < h; j++) {
    const xs = g.byRow[j];
    for (let i = 0; i < w; i++) {
      const ys = g.byCol[i];
      // середина клетки: линии своей строки и своего столбца, с общим наклоном
      const mx = (xs[i] + xs[i + 1]) / 2;
      const my = (ys[j] + ys[j + 1]) / 2;
      const cx = mx + g.sx * (my + g.sy * (mx - g.xc) - g.yc);
      const cy = my + g.sy * (cx - g.xc);
      const hw = (xs[i + 1] - xs[i]) / 2;
      const hh = (ys[j + 1] - ys[j]) / 2;
      const iw = hw * (1 - 2 * inset);
      const ih = hh * (1 - 2 * inset);
      const mid = box(cx - iw, cx + iw, cy - ih, cy + ih);
      // края: полосы между серединой и линиями
      const sides = [box(cx - hw, cx - iw, cy - ih, cy + ih), box(cx + iw, cx + hw, cy - ih, cy + ih), box(cx - iw, cx + iw, cy - hh, cy - ih), box(cx - iw, cx + iw, cy + ih, cy + hh)];
      const o = (j * w + i) * 3;
      rgb[o] = mid.r;
      rgb[o + 1] = mid.g;
      rgb[o + 2] = mid.b;
      // по парам противоположных краёв: сдвиг сетки на точку переносит линию из одной полосы
      // пары в другую, а сумма остаётся
      const dark = (a: number, b: number) => (mid.y > 0 ? 1 - (sides[a].y + sides[b].y) / 2 / mid.y : 0);
      lines[j * w + i] = Math.min(dark(0, 1), dark(2, 3));
    }
  }
  return { w, h, rgb, lines };
}

/** Бумага схемы по умолчанию: цвет — не дальше этого от бумаги рядом, сетка — видна хоть так. */
export const PAPER_DELTA = 0.06;
export const PAPER_LINES = 0.05;
/** Бумага рядом — клетки с видной сеткой в окне ±столько клеток. */
const PAPER_WINDOW = 8;

/**
 * Среднее по клеткам-образцам в окне ±`r` клеток вокруг каждой клетки, линейный свет; где
 * образцов меньше пяти — `fallback`.
 */
function windowMean(g: ChartCells, seed: (i: number) => boolean, r: number, fallback: [number, number, number]): Float64Array {
  const { w, h } = g;
  // суммы по прямоугольникам: [r, g, b, число] образцов
  const W1 = w + 1;
  const sum = new Float64Array(W1 * (h + 1) * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const on = seed(i);
      const o = ((y + 1) * W1 + x + 1) * 4;
      for (let k = 0; k < 4; k++) {
        const v = on ? (k < 3 ? g.rgb[i * 3 + k] : 1) : 0;
        sum[o + k] = v + sum[o + k - 4] + sum[o + k - W1 * 4] - sum[o + k - W1 * 4 - 4];
      }
    }
  }
  const out = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const at = (k: number) => sum[(y1 * W1 + x1) * 4 + k] - sum[(y0 * W1 + x1) * 4 + k] - sum[(y1 * W1 + x0) * 4 + k] + sum[(y0 * W1 + x0) * 4 + k];
      const n = at(3);
      for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = n >= 5 ? at(k) / n : fallback[k];
    }
  }
  return out;
}

/**
 * Клетки бумаги — фон, который не вышивается: цвет не дальше `delta` от бумаги рядом и сетка
 * видна хотя бы на `lines` — белая шерсть бывает цвета бумаги, но краска закрывает линии.
 * Бумага рядом — средний цвет клеток с видной сеткой и цветом не дальше 0,2 от бумаги из
 * карточки в окне ±PAPER_WINDOW клеток: цвет бумаги меняется по листу (пожелтела полосами,
 * тень скана у корешка).
 */
export function paperCells(g: ChartCells, canvas: number, delta: number, lines: number): Uint8Array {
  const ref = rgbToLab(canvas);
  const labs: Lab[] = Array.from({ length: g.w * g.h }, (_, i) => linearToLab(g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2]));
  const near = windowMean(g, (i) => g.lines[i] >= lines && deltaOK(labs[i], ref) < 0.2, PAPER_WINDOW, labToLinear(ref));
  const out = new Uint8Array(g.w * g.h);
  const off = new Float64Array(g.w * g.h);
  for (let i = 0; i < out.length; i++) {
    off[i] = deltaOK(labs[i], linearToLab(near[i * 3], near[i * 3 + 1], near[i * 3 + 2]));
    if (g.lines[i] >= lines && off[i] < delta) out[i] = 1;
  }
  despeckle(out, g.w, g.h, (i) => off[i] < STAIN);
  return out;
}

/**
 * Бумага листа, выбеленного whiten: клетки ближе `delta` к белому. Сетка не нужна: белой
 * краски в такой печати нет, а бледный край соседней краски линии как раз закрывает.
 */
export function whitePaperCells(g: ChartCells, delta: number): Uint8Array {
  const white = rgbToLab(0xffffff);
  const out = new Uint8Array(g.w * g.h);
  const off = new Float64Array(g.w * g.h);
  for (let i = 0; i < out.length; i++) {
    off[i] = deltaOK(linearToLab(g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2]), white);
    if (off[i] < delta) out[i] = 1;
  }
  despeckle(out, g.w, g.h, (i) => off[i] < STAIN);
  return out;
}

/** Белая бумага: каждый канал — не темнее такой доли от верхнего края листа (WHITE_TOP). */
const WHITE_SEED = 0.75;
const WHITE_TOP = 0.95;
/** Бумага рядом для белой точки — в окне ±столько клеток: тень у корешка меняется медленно. */
const WHITE_WINDOW = 12;

/**
 * Схема на белой бумаге, а скан пожелтел (журнальный лист, печать прозрачными красками):
 * цвет клетки — относительно бумаги рядом, как если бы бумага осталась белой; заодно уходит
 * тень у корешка. Прозрачная краска темнее бумаги хотя бы в одном канале (жёлтая — в синем),
 * поэтому бумага — клетки, светлые во всех трёх каналах: не темнее WHITE_SEED от верхнего
 * края листа (доля WHITE_TOP) в каждом. Листы с непрозрачной краской на цветной бумаге
 * (берлинские, на голубой) так не правят: там белила светлее бумаги, а цвет краски от
 * бумаги не зависит.
 */
export function whiten(g: ChartCells): ChartCells {
  const n = g.w * g.h;
  const top = [0, 1, 2].map((k) => {
    const v = Array.from({ length: n }, (_, i) => g.rgb[i * 3 + k]).sort((a, b) => a - b);
    return v[Math.min(n - 1, Math.floor(n * WHITE_TOP))];
  }) as [number, number, number];
  const seed = (i: number) => [0, 1, 2].every((k) => g.rgb[i * 3 + k] >= WHITE_SEED * top[k]);
  const white = windowMean(g, seed, WHITE_WINDOW, top);
  const rgb = new Float64Array(g.rgb.length);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.min(1, g.rgb[i] / Math.max(1e-4, white[i]));
  return { ...g, rgb };
}

/** Пятнышко: столько клеток и меньше, со всех сторон бумага. */
const SPECK = 3;
/** Пятно на бумаге — цвет не дальше этого от бумаги рядом: рыжее, серое; краска — дальше. */
const STAIN = 0.25;

/**
 * Пятнышки на бумаге — фон: рыжие точки старой бумаги, следы карандаша. Пятнышко — не больше
 * SPECK клеток, со всех сторон бумага (и по диагонали — чтобы усики и стебли в клетку наискось
 * остались частью рисунка) и каждая клетка — `stain`: цветом близко к бумаге. Яркая клетка
 * посреди бумаги — замысел: звезда, точка.
 */
function despeckle(paper: Uint8Array, w: number, h: number, stain: (i: number) => boolean = () => true): void {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (paper[i] || seen[i]) continue;
    const comp: number[] = [];
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      comp.push(j);
      const x = j % w, y = (j - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (!paper[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
    }
    if (comp.length <= SPECK && comp.every(stain)) for (const j of comp) paper[j] = 1;
  }
}

async function main() {
  const [file, rect] = process.argv.slice(2);
  if (!file || !rect) {
    console.log('bun tools/content/chart.ts <файл> <слева,сверху,справа,снизу>  (доли кадра)');
    process.exit(1);
  }
  const box = rect.split(',').map(Number) as [number, number, number, number];
  const { data, info } = await sharp(file).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const raster: Raster = { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
  const g = detectChart(raster, box);
  const grid = sampleChart(raster, g, 0.25);
  // цвет бумаги: медиана клеток, где видна сетка (краски нет)
  const paper: number[][] = [];
  for (let i = 0; i < grid.w * grid.h; i++) if (grid.lines![i] >= RULED) paper.push([grid.rgb[i * 3], grid.rgb[i * 3 + 1], grid.rgb[i * 3 + 2]]);
  const med = (k: number) => paper.map((c) => c[k]).sort((a, b) => a - b)[Math.floor(paper.length / 2)] ?? 0;
  const toHex = (x: number) => Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0');
  const hex = paper.length ? `#${toHex(med(0))}${toHex(med(1))}${toHex(med(2))}` : 'нет';
  const f = (x: number) => Number(x.toFixed(4));
  const deg = (s: number) => ((Math.atan(s) * 180) / Math.PI).toFixed(2);
  console.log(`шаг ${g.pitch[0].toFixed(2)} × ${g.pitch[1].toFixed(2)} точек, наклон ${deg(g.sx)}° и ${deg(g.sy)}°, чёткость ${g.score[0].toFixed(2)} и ${g.score[1].toFixed(2)}`);
  console.log(`клеток без краски (видна сетка): ${((paper.length * 100) / (grid.w * grid.h)).toFixed(0)} %`);
  console.log(`крайние линии: x ${f(g.xs[0] / raster.width)}…${f(g.xs[grid.w] / raster.width)}, y ${f(g.ys[0] / raster.height)}…${f(g.ys[grid.h] / raster.height)} (доли кадра, у середины)`);
  console.log('pattern:');
  console.log(`  chart: [${box.map(f).join(', ')}]   # рамка чуть шире сетки; линии сборка находит сама, поле отрезает`);
  console.log(`  cells: [${grid.w}, ${grid.h}]`);
  console.log(`  size: ${Math.max(grid.w, grid.h)}`);
  console.log(`  canvas: "${hex}"   # бумага схемы — фон, не вышивается`);
}

if (import.meta.main) await main();
