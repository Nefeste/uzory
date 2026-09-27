// Канва без телефона: тот же шейдер на CanvasKit (Skia в WASM, та же версия, что у Skia
// 2.6.2 в вебе), рисование на процессоре. Для золотых кадров в тестах и кадров для глаз.
import CanvasKitInit from 'canvaskit-wasm/bin/full/canvaskit.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SKSL, uniformList, type Uniforms } from '../../src/canvas/shader';
import { CANVAS, type Pattern } from '../../src/engine/pattern';

const dir = join(dirname(require.resolve('canvaskit-wasm/package.json')), 'bin/full');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CK = any;
let ck: Promise<CK> | null = null;
export const canvasKit = (): Promise<CK> => (ck ??= CanvasKitInit({ locateFile: (f: string) => join(dir, f) }));

export const GW = 32;
export const GH = 48;

/**
 * Атлас цифр шрифтом приложения (Onest SemiBold), как src/canvas/textures.ts: проба, затем
 * по центру ячейки по высоте нарисованного.
 */
export async function fontDigitBytes(): Promise<Uint8Array> {
  const CK = await canvasKit();
  const file = join(dirname(require.resolve('@expo-google-fonts/onest/package.json')), '600SemiBold', 'Onest_600SemiBold.ttf');
  const tf = CK.Typeface.MakeTypefaceFromData(readFileSync(file).buffer);
  const font = new CK.Font(tf, 50);
  const W = GW * 10;
  const draw = (baseline: number) => {
    const surface = CK.MakeSurface(W, GH);
    const c = surface.getCanvas();
    c.clear(CK.TRANSPARENT);
    const paint = new CK.Paint();
    paint.setColor(CK.WHITE);
    paint.setAntiAlias(true);
    for (let d = 0; d < 10; d++) {
      const t = String(d);
      const ids = font.getGlyphIDs(t);
      const adv = font.getGlyphWidths(ids)[0];
      c.drawText(t, d * GW + (GW - adv) / 2, baseline, paint, font);
    }
    surface.flush();
    return surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: GH, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
  };
  const guess = GH * 0.8;
  const px = draw(guess);
  let top = GH;
  let bottom = -1;
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] > 40) {
        if (y < top) top = y;
        bottom = y;
        break;
      }
    }
  }
  return draw(guess + GH / 2 - (top + bottom + 1) / 2);
}

/** Атлас цифр: 10 белых цифр по GW × GH — «семисегментные», без шрифта (для тестов хватает). */
export function digitBytes(): Uint8Array {
  const seg: Record<number, string> = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  const r: Record<string, number[]> = { a: [7, 5, 16, 5], b: [21, 7, 5, 16], c: [21, 25, 5, 16], d: [7, 38, 16, 5], e: [4, 25, 5, 16], f: [4, 7, 5, 16], g: [7, 21, 16, 5] };
  const out = new Uint8Array(GW * 10 * GH * 4);
  for (let d = 0; d < 10; d++) {
    for (const s of seg[d]) {
      const [rx, ry, rw, rh] = r[s];
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) out.set([255, 255, 255, 255], (y * GW * 10 + d * GW + x) * 4);
    }
  }
  return out;
}

export function cellBytes(p: Pattern, stitched: Uint8Array): Uint8Array {
  const out = new Uint8Array(p.w * p.h * 4);
  for (let i = 0; i < p.cells.length; i++) {
    out[i * 4] = p.cells[i];
    out[i * 4 + 1] = stitched[i] && p.cells[i] !== CANVAS ? 255 : 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function paletteBytes(p: Pattern): Uint8Array {
  const out = new Uint8Array(64 * 4);
  p.threads.forEach((t, i) => out.set([(t.rgb >> 16) & 255, (t.rgb >> 8) & 255, t.rgb & 255, 255], i * 4));
  return out;
}

export interface Frame {
  width: number;
  height: number;
  pixels: Uint8Array;
  png: () => Uint8Array;
}

/** Рисует кадр: клетка — `s` точек, левый верхний угол узора — (tx, ty). */
export async function renderFrame(p: Pattern, stitched: Uint8Array, opts: {
  width: number; height: number; s: number; tx: number; ty: number;
  near: boolean; mosaic?: boolean; hatch?: boolean; selected?: number;
  /** цифры шрифтом приложения, а не «семисегментные» */
  font?: boolean;
}): Promise<Frame> {
  const CK = await canvasKit();
  const effect = CK.RuntimeEffect.Make(SKSL, (e: string) => { throw new Error(`SkSL: ${e}`); });
  if (!effect) throw new Error('SkSL не собрался');
  const img = (data: Uint8Array, w: number, h: number) => CK.MakeImage({ width: w, height: h, alphaType: CK.AlphaType.Unpremul, colorType: CK.ColorType.RGBA_8888, colorSpace: CK.ColorSpace.SRGB }, data, w * 4);
  const cells = img(cellBytes(p, stitched), p.w, p.h);
  const pal = img(paletteBytes(p), 64, 1);
  const dig = img(opts.font ? await fontDigitBytes() : digitBytes(), GW * 10, GH);
  const nearest = (i: CK) => i.makeShaderOptions(CK.TileMode.Clamp, CK.TileMode.Clamp, CK.FilterMode.Nearest, CK.MipmapMode.None);
  const linear = (i: CK) => i.makeShaderOptions(CK.TileMode.Clamp, CK.TileMode.Clamp, CK.FilterMode.Linear, CK.MipmapMode.None);
  const u: Uniforms = {
    w: p.w, h: p.h, gw: GW, gh: GH, cellPx: opts.s, near: opts.near ? 1 : 0, selected: opts.selected ?? -1,
    mosaic: opts.mosaic ? 1 : 0, hatch: opts.hatch ? 1 : 0, gap: 0.5 / opts.s, px0: 0, py0: 0, px1: -1, py1: -1, pulseT: -1,
  };
  const lm = CK.Matrix.multiply(CK.Matrix.translated(opts.tx, opts.ty), CK.Matrix.scaled(opts.s, opts.s));
  const shader = effect.makeShaderWithChildren(uniformList(u), [nearest(cells), nearest(pal), linear(dig)], lm);
  const surface = CK.MakeSurface(opts.width, opts.height);
  const paint = new CK.Paint();
  paint.setShader(shader);
  surface.getCanvas().drawRect(CK.XYWHRect(0, 0, opts.width, opts.height), paint);
  surface.flush();
  const snap = surface.makeImageSnapshot();
  const pixels = snap.readPixels(0, 0, { width: opts.width, height: opts.height, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
  return { width: opts.width, height: opts.height, pixels, png: () => snap.encodeToBytes() as Uint8Array };
}
