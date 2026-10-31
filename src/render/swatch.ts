// Образец канвы для экрана «Оформление» (src/screens/LooksScreen.tsx): несколько клеток тем же шейдером, что
// канва, — ромбик крестиками двумя нитями на ткани этой канвы. Рисуется один раз на канву и запоминается.
import { FilterMode, ImageFormat, MipmapMode, Skia, TileMode } from '@shopify/react-native-skia';
import { canvasEffect } from '../canvas/effect';
import { GLYPH_H, GLYPH_W } from '../canvas/glyphs';
import { canvasUniforms, NO_SCENE, uniformList } from '../canvas/shader';
import { cellBytes, paletteImage, rgbaImage } from '../canvas/textures';
import type { CanvasLook } from '../engine/looks';
import { CANVAS, type Pattern } from '../engine/pattern';
import { logError } from '../state/crashlog';

/** Клеток по сторонам и точек на клетку: крестик со светом виден, как на рабочем масштабе. */
const W = 7;
const H = 4;
const CELL = 36;
const C = CANVAS;
/** Ромбик кумачом с зелёной серединой; по краям — пустая канва. */
const SAMPLE: Pattern = {
  key: 'swatch@1', w: W, h: H,
  threads: [{ rgb: 0xb3162f, name: 'red' }, { rgb: 0x3f6b3a, name: 'green' }],
  cells: Uint8Array.from([
    C, C, C, 0, C, C, C,
    C, C, 0, 1, 0, C, C,
    C, C, 0, 1, 0, C, C,
    C, C, C, 0, C, C, C,
  ]),
} as Pattern;
const STITCHED = Uint8Array.from(SAMPLE.cells, (c) => (c === CANVAS ? 0 : 1));

const cache = new Map<string, string | null>();

/** Образец канвы картинкой (data: URI PNG); Skia не смогла — null. */
export function canvasSwatch(look: CanvasLook): string | null {
  if (cache.has(look.id)) return cache.get(look.id)!;
  let uri: string | null = null;
  try {
    const surface = Skia.Surface.Make(W * CELL, H * CELL);
    const effect = canvasEffect();
    const cells = rgbaImage(cellBytes(SAMPLE, STITCHED), W, H);
    const pal = paletteImage(SAMPLE);
    // номеров на образце нет — атлас цифр не нужен, хватит белой точки
    const dig = rgbaImage(new Uint8Array(4).fill(255), 1, 1);
    if (surface && effect && cells && pal && dig) {
      const m = Skia.Matrix();
      m.scale(CELL, CELL);
      const shader = effect.makeShaderWithChildren(uniformList({
        w: W, h: H, gw: GLYPH_W, gh: GLYPH_H, cellPx: CELL, near: 1, selected: -1, mosaic: 0, hatch: 0, gap: 0.5 / CELL,
        px0: -1, py0: -1, px1: -1, py1: -1, pulseT: -1, ...NO_SCENE, ...canvasUniforms(look, true),
      }), [
        cells.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None),
        pal.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None),
        dig.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None),
      ], m);
      const paint = Skia.Paint();
      paint.setShader(shader);
      surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, W * CELL, H * CELL), paint);
      surface.flush();
      uri = `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 100)}`;
    }
  } catch (e) {
    logError('render', e, 'canvas swatch');
  }
  cache.set(look.id, uri);
  return uri;
}
