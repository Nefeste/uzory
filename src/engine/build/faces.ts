// «Найти лица» (issue 146; владелец 01.11.2026: «делаем и „найти лица“…»): лица на снимке — овалы главного.
// Детектор — pico: деревья сравнений яркости пар точек, каскад лиц анфас и вполоборота (±30°). Порт pico.js
// (MIT, © 2013 Nenad Markus, https://github.com/nenadmarkus/picojs); каскад `facefinder` — из репозитория
// pico того же автора (MIT), лежит рядом: assets/faces/facefinder. Чистый TypeScript, без платформы (ADR 0002).
import type { Rect } from './eyes';
import type { Raster } from './grid';

/**
 * Лицензия pico и pico.js (MIT; assets/faces/LICENSES.md): каскад и порт едут в APK — уведомление показывает
 * «О программе».
 */
export const PICO_NOTICE = 'The MIT License\n\nCopyright (c) 2013 Nenad Markus\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';

export interface Cascade {
  tdepth: number;
  ntrees: number;
  tcodes: Int8Array;
  tpreds: Float32Array;
  thresh: Float32Array;
}

/** Находка: середина и сторона квадрата лица в точках снимка, уверенность. */
export interface Face {
  x: number;
  y: number;
  size: number;
  score: number;
}

/** Каскад из файла pico: 8 байт заголовка, глубина деревьев, их число и сами деревья. */
export function unpackCascade(bytes: Uint8Array): Cascade {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  const tdepth = dv.getInt32(p, true);
  const ntrees = dv.getInt32(p + 4, true);
  p += 8;
  const n = 2 ** tdepth;
  if (!(tdepth > 0 && tdepth < 12 && ntrees > 0 && ntrees < 10000)) throw new Error('faces: not a pico cascade');
  const tcodes = new Int8Array(ntrees * 4 * n);
  const tpreds = new Float32Array(ntrees * n);
  const thresh = new Float32Array(ntrees);
  for (let t = 0; t < ntrees; t++) {
    // узел 0 не используется: первые четыре кода дерева — нули
    for (let i = 0; i < 4 * n - 4; i++) tcodes[t * 4 * n + 4 + i] = (bytes[p + i] << 24) >> 24;
    p += 4 * n - 4;
    for (let i = 0; i < n; i++, p += 4) tpreds[t * n + i] = dv.getFloat32(p, true);
    thresh[t] = dv.getFloat32(p, true);
    p += 4;
  }
  return { tdepth, ntrees, tcodes, tpreds, thresh };
}

/** Окно `s` точек с серединой (r, c): уверенность, что это лицо; меньше нуля — не лицо. */
function classify(cs: Cascade, r: number, c: number, s: number, px: Uint8Array, w: number): number {
  const rr = 256 * r, cc = 256 * c;
  const n = 2 ** cs.tdepth;
  const { tcodes, tpreds, thresh } = cs;
  let root = 0, o = 0;
  for (let i = 0; i < cs.ntrees; i++) {
    let idx = 1;
    for (let j = 0; j < cs.tdepth; j++) {
      const k = root + 4 * idx;
      // `>> 8` — целочисленное деление, как в pico.js: от него зависит, какую точку сравнивать
      const a = px[((rr + tcodes[k] * s) >> 8) * w + ((cc + tcodes[k + 1] * s) >> 8)];
      const b = px[((rr + tcodes[k + 2] * s) >> 8) * w + ((cc + tcodes[k + 3] * s) >> 8)];
      idx = 2 * idx + (a <= b ? 1 : 0);
    }
    o += tpreds[n * i + idx - n];
    if (o <= thresh[i]) return -1;
    root += 4 * n;
  }
  return o - thresh[cs.ntrees - 1];
}

/**
 * Кадр снимка серым для детектора, уменьшенный усреднением до `w` × `h`: яркость — (2R + 7G + B) / 10, как
 * в pico.js. Кадр — точки [x0, x0 + cw) × [y0, y0 + ch) снимка.
 */
export function grayCrop(r: Raster, x0: number, y0: number, cw: number, ch: number, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  grayRows(r, x0, y0, cw, ch, w, h, g, 0, h);
  return g;
}

/** Строки [j0, j1) серого кадра `grayCrop` — в `g`. */
function grayRows(r: Raster, x0: number, y0: number, cw: number, ch: number, w: number, h: number, g: Uint8Array, j0: number, j1: number): void {
  for (let j = j0; j < j1; j++) {
    const sy0 = y0 + Math.floor((j * ch) / h), sy1 = Math.max(sy0 + 1, y0 + Math.floor(((j + 1) * ch) / h));
    for (let i = 0; i < w; i++) {
      const sx0 = x0 + Math.floor((i * cw) / w), sx1 = Math.max(sx0 + 1, x0 + Math.floor(((i + 1) * cw) / w));
      let sum = 0, n = 0;
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const o = (y * r.width + x) * 3;
          sum += 2 * r.data[o] + 7 * r.data[o + 1] + r.data[o + 2];
          n++;
        }
      }
      g[j * w + i] = sum / (10 * n);
    }
  }
}

/** Строк серого кадра между передышками: снимок в 2000 точек — около 15 передышек. */
const GRAY_ROWS = 32;

/**
 * Опыт на снимках библиотеки (issue 146; docs/specs/2026-09-custom.md, «Найти лица»): 640 точек по длинной
 * стороне, лицо — от 28 точек, порог 12 (на 13 — на одно лицо из 50 меньше, лишних находок столько же).
 */
export const FACE_SIDE = 640;
export const FACE_MIN = 28;
export const FACE_SCORE = 12;

/** Окон детектора между передышками поиска: на телефоне без JIT — несколько миллисекунд счёта (src/state/faces.ts). */
export const FACE_CHUNK = 4000;

/** Окна одного ряда: середины на строке `r`, окно `s`, шаг `step`; ответ — сколько окон. */
function scanRow(cs: Cascade, px: Uint8Array, w: number, s: number, r: number, step: number, off: number, out: Face[]): number {
  let n = 0;
  for (let c = off; c <= w - off; c += step) {
    const q = classify(cs, r, c, s, px, w);
    if (q > 0) out.push({ x: c, y: r, size: s, score: q });
    n++;
  }
  return n;
}

/**
 * Все окна-лица в сером снимке `w` × `h`: сдвиг — десятая доля окна, окно растёт в 1,1 раза. После каждых
 * `FACE_CHUNK` окон — `yield`: поиск можно растянуть на несколько кадров экрана, и палец на рамке не ждёт.
 */
export function* scanSteps(cs: Cascade, px: Uint8Array, w: number, h: number, min = FACE_MIN): Generator<void, Face[], void> {
  const out: Face[] = [];
  const max = Math.min(w, h);
  let n = 0;
  for (let s = min; s <= max; s *= 1.1) {
    const step = Math.max(0.1 * s, 1) >> 0;
    const off = (s / 2 + 1) >> 0;
    for (let r = off; r <= h - off; r += step) {
      n += scanRow(cs, px, w, s, r, step, off, out);
      if (n >= FACE_CHUNK) {
        n = 0;
        yield;
      }
    }
  }
  return out;
}

/** Шаги поиска — до конца, без передышек. */
export function drain<T>(steps: Generator<void, T, void>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Все окна-лица сразу (`scanSteps` без передышек). */
export const scan = (cs: Cascade, px: Uint8Array, w: number, h: number, min = FACE_MIN): Face[] => drain(scanSteps(cs, px, w, h, min));

const iou = (a: Face, b: Face) => {
  const ox = Math.max(0, Math.min(a.x + a.size / 2, b.x + b.size / 2) - Math.max(a.x - a.size / 2, b.x - b.size / 2));
  const oy = Math.max(0, Math.min(a.y + a.size / 2, b.y + b.size / 2) - Math.max(a.y - a.size / 2, b.y - b.size / 2));
  return (ox * oy) / (a.size * a.size + b.size * b.size - ox * oy);
};

/**
 * Кучки окон вокруг одного лица — одно лицо: середина и сторона — средние, уверенность — сумма (как в
 * pico.js: окно может войти и в соседнюю кучку). Сильные — первыми.
 */
export function cluster(list: Face[], th = 0.2): Face[] {
  const d = [...list].sort((a, b) => b.score - a.score);
  const used = new Uint8Array(d.length);
  const out: Face[] = [];
  for (let i = 0; i < d.length; i++) {
    if (used[i]) continue;
    let x = 0, y = 0, s = 0, q = 0, n = 0;
    for (let j = i; j < d.length; j++) {
      if (iou(d[i], d[j]) <= th) continue;
      used[j] = 1;
      x += d[j].x;
      y += d[j].y;
      s += d[j].size;
      q += d[j].score;
      n++;
    }
    out.push({ x: x / n, y: y / n, size: s / n, score: q });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Овалов главного по лицам — не больше стольких (как рамок лиц у карточки — 12, но на телефоне их двигать). */
export const FACE_MAX = 6;

/**
 * Овалы главного по лицам кадра `crop` снимка (доли снимка), сильные — первыми. Окно детектора — лицо от
 * бровей до подбородка; овал главного шире в 1,4 и выше в 1,7 раза и чуть выше середины: с волосами,
 * ушами и подбородком. Овалы, которые почти совпали (одно лицо нашлось дважды), — один.
 */
export function* faceOvalSteps(r: Raster, crop: Rect, cs: Cascade): Generator<void, Rect[], void> {
  const x0 = Math.max(0, Math.round(crop[0] * r.width)), y0 = Math.max(0, Math.round(crop[1] * r.height));
  const cw = Math.max(1, Math.min(r.width - x0, Math.round((crop[2] - crop[0]) * r.width)));
  const ch = Math.max(1, Math.min(r.height - y0, Math.round((crop[3] - crop[1]) * r.height)));
  const k = Math.min(1, FACE_SIDE / Math.max(cw, ch));
  const w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
  const gray = new Uint8Array(w * h);
  for (let j = 0; j < h; j += GRAY_ROWS) {
    grayRows(r, x0, y0, cw, ch, w, h, gray, j, Math.min(h, j + GRAY_ROWS));
    yield;
  }
  const faces = cluster(yield* scanSteps(cs, gray, w, h)).filter((f) => f.score >= FACE_SCORE);
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const out: Rect[] = [];
  for (const f of faces) {
    const cx = (x0 + f.x / k) / r.width, cy = (y0 + (f.y - 0.05 * f.size) / k) / r.height;
    const hw = (0.7 * f.size) / k / r.width, hh = (0.85 * f.size) / k / r.height;
    const o: Rect = [clamp01(cx - hw), clamp01(cy - hh), clamp01(cx + hw), clamp01(cy + hh)];
    if (out.some((p) => overlap(p, o) > 0.5)) continue;
    out.push(o);
    if (out.length >= FACE_MAX) break;
  }
  return out;
}

/** Овалы по лицам сразу (`faceOvalSteps` без передышек). */
export const faceOvals = (r: Raster, crop: Rect, cs: Cascade): Rect[] => drain(faceOvalSteps(r, crop, cs));

/** Доля меньшей рамки, которую закрывает другая. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
  return area > 0 ? (w * h) / area : 0;
}
