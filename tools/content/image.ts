// Исходник для сборки (docs/specs/2026-09-content-pipeline.md, шаг 2): sharp читает файл —
// поворот по EXIF, перевод в sRGB. Кадр и сетка — src/engine/build/grid.ts, общие со своим
// узором в приложении.
import sharp from 'sharp';
import type { Raster } from '../../src/engine/build/grid';
import { LINEAR, labToRgb, linearToLab, rgbToLab } from '../../src/engine/color';

export { type Grid, type Raster, toGrid } from '../../src/engine/build/grid';

export async function decode(file: string): Promise<Raster> {
  const { data, info } = await sharp(file).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`${file}: ${info.channels} канала вместо 3`);
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

/** Строк (столбцов) за краем заплатки, по которым берётся её цвет: одна строка — шум бумаги и мазков. */
const PATCH_EDGE = 3;

/**
 * Заплатка (`pattern.patch`, с 0.24.2): в каждой рамке (доли снимка) исходник закрашивается цветом её
 * краёв — поперёк короткой стороны, плавно от одного края к другому. Белая полоса поперёк стебля
 * «Оранжевых лилий» («посередине убрать белую полосу» — отбор владельца 01.11.2026): стебель над ней и под
 * ней сходится. Край за пределами снимка — цвет другого края. Исходник не меняется — новый растр.
 */
export function patchRaster(r: Raster, rects: readonly (readonly [number, number, number, number])[]): Raster {
  const { width: W, height: H } = r;
  const data = new Uint8Array(r.data);
  for (const [fx0, fy0, fx1, fy1] of rects) {
    const x0 = Math.max(0, Math.round(fx0 * W)), x1 = Math.min(W, Math.round(fx1 * W));
    const y0 = Math.max(0, Math.round(fy0 * H)), y1 = Math.min(H, Math.round(fy1 * H));
    if (x1 <= x0 || y1 <= y0) continue;
    const across = x1 - x0 >= y1 - y0;
    // вдоль рамки — линии (столбцы у широкой, строки у высокой), поперёк — от края до края
    const [l0, l1, a0, a1, len] = across ? [x0, x1, y0, y1, H] : [y0, y1, x0, x1, W];
    const at = (line: number, k: number) => (across ? k * W + line : line * W + k) * 3;
    for (let line = l0; line < l1; line++) {
      const mean = (from: number, step: number) => {
        const c = [0, 0, 0];
        let n = 0;
        for (let k = from, i = 0; i < PATCH_EDGE && k >= 0 && k < len; k += step, i++, n++) for (let ch = 0; ch < 3; ch++) c[ch] += r.data[at(line, k) + ch];
        return n ? c.map((v) => v / n) : null;
      };
      const before = mean(a0 - 1, -1), after = mean(a1, 1);
      const [b, e] = [before ?? after, after ?? before];
      if (!b || !e) continue;
      for (let k = a0; k < a1; k++) {
        const t = (k - a0 + 1) / (a1 - a0 + 1);
        for (let ch = 0; ch < 3; ch++) data[at(line, k) + ch] = Math.round(b[ch] + (e[ch] - b[ch]) * t);
      }
    }
  }
  return { ...r, data };
}

/** Точка внутри многоугольника (луч вправо, чётность пересечений). */
function inside(pts: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let odd = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

/**
 * Окраска (`pattern.paint`, с 0.24.2): внутри многоугольника (доли снимка) точки получают цвет `color` в
 * OKLab — его оттенок, а светлоту — его плюс отклонение точки от средней светлоты многоугольника: тени,
 * блики и ноздря остаются. Клюв селезня, слившийся с травой, — коричневый («клюв слился с травой, сделать
 * его коричневым» — отбор владельца 01.11.2026). Исходник не меняется — новый растр.
 */
export function paintRaster(r: Raster, paints: readonly { color: number; points: readonly (readonly [number, number])[] }[]): Raster {
  const { width: W, height: H } = r;
  const data = new Uint8Array(r.data);
  for (const { color, points } of paints) {
    const pts = points.map(([x, y]) => [x * W, y * H] as const);
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])))), x1 = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])))), y1 = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p[1]))));
    const at: number[] = [];
    const ls: number[] = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!inside(pts, x + 0.5, y + 0.5)) continue;
        const o = (y * W + x) * 3;
        at.push(o);
        ls.push(linearToLab(LINEAR[r.data[o]], LINEAR[r.data[o + 1]], LINEAR[r.data[o + 2]])[0]);
      }
    }
    if (!at.length) continue;
    const mean = ls.reduce((s, l) => s + l, 0) / ls.length;
    const [tl, ta, tb] = rgbToLab(color);
    at.forEach((o, i) => {
      const rgb = labToRgb([Math.max(0, Math.min(1, tl + ls[i] - mean)), ta, tb]);
      data[o] = (rgb >> 16) & 255;
      data[o + 1] = (rgb >> 8) & 255;
      data[o + 2] = rgb & 255;
    });
  }
  return { ...r, data };
}
