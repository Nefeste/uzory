// Уменьшение снимка на телефоне (src/engine/build/shrink.ts, src/state/photo.ts; 0.18.2): половинками —
// без ряби. CanvasKit — та же Skia в вебе, и drawImageRectOptions у неё, как у RN Skia на телефоне, —
// со строгой границей исходника: мип-карты не берутся, сколько их ни проси.
import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import CanvasKitInit, { type CanvasKit, type Image } from 'canvaskit-wasm';
import { shrinkSteps } from '../../src/engine/build/shrink';

const WASM = dirname(require.resolve('canvaskit-wasm'));
let ck: CanvasKit | null = null;
const kit = async () => (ck ??= await CanvasKitInit({ locateFile: (f: string) => join(WASM, f) }));

/** Шахматка в одну точку: правильно уменьшенная — ровный серый. */
function checker(CK: CanvasKit, w: number, h: number): Image {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (x + y) & 1 ? 255 : 0;
      px.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return CK.MakeImage({ width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }, px, w * 4)!;
}

/** Уменьшение по шагам, как в src/state/photo.ts: линейная выборка, мип-карты — как просит photo.ts до 0.18.2. */
function shrinkBy(CK: CanvasKit, img: Image, steps: [number, number][]): Uint8Array {
  let src = img;
  for (const [w, h] of steps) {
    const s = CK.MakeSurface(w, h)!;
    s.getCanvas().drawImageRectOptions(src, CK.XYWHRect(0, 0, src.width(), src.height()), CK.XYWHRect(0, 0, w, h), CK.FilterMode.Linear, CK.MipmapMode.Linear);
    s.flush();
    src = s.makeImageSnapshot();
  }
  const [w, h] = steps[steps.length - 1];
  return src.readPixels(0, 0, { width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
}

/** Разброс яркости по картинке: у ровного серого — 0. */
function spread(px: Uint8Array): number {
  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    s += px[i];
    s2 += px[i] * px[i];
    n++;
  }
  return Math.sqrt(s2 / n - (s / n) ** 2);
}

describe('уменьшение снимка', () => {
  test('шаги: половинками, пока вдвое больше нужного; последний — до нужного', () => {
    // 50 Мп → 2000 точек: 8160 → 4080 → 2040 → 2000
    expect(shrinkSteps(8160, 6120, 2000, 1500)).toEqual([[4080, 3060], [2040, 1530], [2000, 1500]]);
    // 13 Мп: 4160 → 2080 → 2000
    expect(shrinkSteps(4160, 3120, 2000, 1500)).toEqual([[2080, 1560], [2000, 1500]]);
    // нечётное — с запасом в точку, шаг остаётся почти ровно вдвое
    expect(shrinkSteps(4081, 3061, 2000, 1500)).toEqual([[2041, 1531], [2000, 1500]]);
    // снимок не больше нужного — один шаг, на белое
    expect(shrinkSteps(1600, 1200, 1600, 1200)).toEqual([[1600, 1200]]);
  });

  test('одним шагом в 4,08 раза — рябь; половинками — ровный серый', async () => {
    const CK = await kit();
    // как 8160 × 6120 → 2000 × 1500, только вчетверо меньше по сторонам
    const img = checker(CK, 2040, 1530);
    const once = spread(shrinkBy(CK, img, [[500, 375]]));
    const halves = shrinkBy(CK, img, shrinkSteps(2040, 1530, 500, 375));
    expect(once).toBeGreaterThan(20);
    expect(spread(halves)).toBeLessThan(2);
    let mean = 0;
    for (let i = 0; i < halves.length; i += 4) mean += halves[i];
    expect(mean / (halves.length / 4)).toBeCloseTo(127.5, -1);
  });
});
