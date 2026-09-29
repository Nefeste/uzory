// «Поделиться» (docs/08-game-design.md, «Готово»; docs/specs/2026-09-library.md, «Готово»):
// готовая работа в выбранном стиле тем же шейдером, что канва, в рамке на льняном фоне, под
// рамкой — название, подпись картины и мелко «Вышито в „Узорах“». Сторона — до 2000 точек.
import { ImageFormat, Skia, type SkFont, TileMode, FilterMode, MipmapMode } from '@shopify/react-native-skia';
import { NUMBERS_DP } from '../canvas/camera';
import { SKSL, uniformList } from '../canvas/shader';
import { cellBytes, digitAtlas, GLYPH_H, GLYPH_W, paletteImage, rgbaImage } from '../canvas/textures';
import type { Pattern } from '../engine/pattern';

/**
 * Работа в картинке — длинная сторона не больше стольких точек, клетка — не больше 64: с рамкой
 * и подписью (ещё 386 точек) вся картинка не больше 2000 точек по стороне.
 */
const PICTURE_MAX = 1600;
const OUT = 72;
const FRAME = 18;
const MAT = 44;
const CAPTION = 190;

export interface ShareText {
  title: string;
  /** автор и год, если есть */
  caption?: string;
  /** «Вышито в „Узорах“» */
  mark: string;
}

/** PNG готовой работы; Skia не смогла — null. */
export function shareImage(p: Pattern, stitched: Uint8Array, mosaic: boolean,
  fonts: { title: SkFont; text: SkFont; digits: SkFont }, text: ShareText): Uint8Array | null {
  const cell = Math.max(1, Math.min(64, Math.floor(PICTURE_MAX / Math.max(p.w, p.h))));
  const pw = p.w * cell;
  const ph = p.h * cell;
  const W = pw + 2 * (MAT + FRAME + OUT);
  const H = ph + 2 * (MAT + FRAME) + OUT + CAPTION;
  const surface = Skia.Surface.Make(W, H);
  const effect = Skia.RuntimeEffect.Make(SKSL);
  const pal = paletteImage(p);
  const dig = digitAtlas(fonts.digits);
  const cells = rgbaImage(cellBytes(p, stitched), p.w, p.h);
  if (!surface || !effect || !pal || !dig || !cells) return null;
  const c = surface.getCanvas();

  const paint = (hex: string) => {
    const pt = Skia.Paint();
    pt.setColor(Skia.Color(hex));
    pt.setAntiAlias(true);
    return pt;
  };
  c.drawRect(Skia.XYWHRect(0, 0, W, H), paint('#ecede6'));
  // рамка: тёмное дерево, внутри — бумажное паспарту
  const fx = OUT;
  const fy = OUT;
  c.drawRect(Skia.XYWHRect(fx, fy, pw + 2 * (MAT + FRAME), ph + 2 * (MAT + FRAME)), paint('#6f5641'));
  c.drawRect(Skia.XYWHRect(fx + FRAME, fy + FRAME, pw + 2 * MAT, ph + 2 * MAT), paint('#f7f7f2'));

  // работа — тем же шейдером, что канва: крупная клетка — стежками, мелкая — цветом
  const x0 = fx + FRAME + MAT;
  const y0 = fy + FRAME + MAT;
  const m = Skia.Matrix();
  m.translate(x0, y0);
  m.scale(cell, cell);
  const shader = effect.makeShaderWithChildren(uniformList({
    w: p.w, h: p.h, gw: GLYPH_W, gh: GLYPH_H, cellPx: cell, near: cell >= NUMBERS_DP ? 1 : 0, selected: -1,
    mosaic: mosaic ? 1 : 0, hatch: 0, gap: 0.5 / cell, px0: -1, py0: -1, px1: -1, py1: -1, pulseT: -1,
  }), [
    cells.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None),
    pal.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None),
    dig.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None),
  ], m);
  const work = Skia.Paint();
  work.setShader(shader);
  c.drawRect(Skia.XYWHRect(x0, y0, pw, ph), work);

  // подпись по центру под рамкой
  const center = (s: string, font: SkFont, y: number, color: string) => {
    const w = font.getTextWidth(s);
    c.drawText(s, (W - w) / 2, y, paint(color), font);
  };
  const base = fy + ph + 2 * (MAT + FRAME);
  center(text.title, fonts.title, base + 72, '#1a1b1e');
  if (text.caption) center(text.caption, fonts.text, base + 118, '#4b4f4c');
  center(text.mark, fonts.text, base + (text.caption ? 164 : 130), '#b3162f');
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG, 100);
}
