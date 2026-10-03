// «Поделиться» (docs/08-game-design.md, «Готово»; docs/specs/2026-09-library.md, «Готово»):
// готовая работа в выбранном стиле тем же шейдером, что канва, в рамке на льняном фоне, под
// рамкой — название, подпись картины и мелко «Вышито в „Узорах“». Сторона — до 2000 точек.
// Где что лежит и каких цветов — src/engine/share.ts: по нему же сценарий проверяет картинку.
import { ImageFormat, Skia, type SkFont, TileMode, FilterMode, MipmapMode } from '@shopify/react-native-skia';
import { NUMBERS_DP } from '../canvas/camera';
import { SKSL, uniformList } from '../canvas/shader';
import { cellBytes, digitAtlas, GLYPH_H, GLYPH_W, paletteImage, rgbaImage } from '../canvas/textures';
import type { Pattern } from '../engine/pattern';
import { SHARE_COLORS, shareLayout, type ShareRect } from '../engine/share';

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
  const L = shareLayout(p.w, p.h);
  const { cell, work: wr } = L;
  const surface = Skia.Surface.Make(L.width, L.height);
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
  const rect = (r: ShareRect) => Skia.XYWHRect(r.x, r.y, r.w, r.h);
  c.drawRect(Skia.XYWHRect(0, 0, L.width, L.height), paint(SHARE_COLORS.background));
  // рамка: тёмное дерево, внутри — бумажное паспарту
  c.drawRect(rect(L.frame), paint(SHARE_COLORS.frame));
  c.drawRect(rect(L.mat), paint(SHARE_COLORS.mat));

  // работа — тем же шейдером, что канва: крупная клетка — стежками, мелкая — цветом
  const m = Skia.Matrix();
  m.translate(wr.x, wr.y);
  m.scale(cell, cell);
  const shader = effect.makeShaderWithChildren(uniformList({
    w: p.w, h: p.h, gw: GLYPH_W, gh: GLYPH_H, cellPx: cell, near: cell >= NUMBERS_DP ? 1 : 0, selected: -1,
    mosaic: mosaic ? 1 : 0, hatch: 0, gap: 0.5 / cell, px0: -1, py0: -1, px1: -1, py1: -1, pulseT: -1,
  }), [
    cells.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None),
    pal.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None),
    dig.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None),
  ], m);
  const workPaint = Skia.Paint();
  workPaint.setShader(shader);
  c.drawRect(rect(wr), workPaint);

  // подпись по центру под рамкой
  const center = (s: string, font: SkFont, y: number, color: string) => {
    const w = font.getTextWidth(s);
    c.drawText(s, (L.width - w) / 2, y, paint(color), font);
  };
  center(text.title, fonts.title, L.title, SHARE_COLORS.title);
  if (text.caption) center(text.caption, fonts.text, L.caption, SHARE_COLORS.caption);
  center(text.mark, fonts.text, text.caption ? L.mark : L.markAlone, SHARE_COLORS.mark);
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG, 100);
}
