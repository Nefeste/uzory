// «Поделиться» (docs/08-game-design.md, «Готово»; docs/specs/2026-09-library.md, «Готово»):
// готовая работа тем же шейдером, что канва, — ровными клетками цвета или, по настройке, стежками
// выбранного стиля, — в рамке на льняном фоне, под рамкой — название, подпись картины и мелко
// «Вышито в „Узорах“». Сторона — до 2000 точек.
// Где что лежит и каких цветов — src/engine/share.ts: по нему же сценарий проверяет картинку.
import { ImageFormat, Skia, type SkFont, TileMode, FilterMode, MipmapMode } from '@shopify/react-native-skia';
import { canvasEffect } from '../canvas/effect';
import { canvasUniforms, NO_SCENE, uniformList } from '../canvas/shader';
import { cellBytes, digitAtlas, GLYPH_H, GLYPH_W, paletteImage, rgbaImage } from '../canvas/textures';
import { CANVASES, type CanvasLook, FRAMES, type FrameLook } from '../engine/looks';
import type { Pattern } from '../engine/pattern';
import { HOOP_RING, SHARE_COLORS, shareLayout, type ShareRect, shareStitches } from '../engine/share';

export interface ShareText {
  title: string;
  /** автор и год, если есть */
  caption?: string;
  /** «Вышито в „Узорах“» */
  mark: string;
}

/** Как рисовать работу: стиль и настройка «Стежки на картинке „Поделиться“». */
export interface ShareLook {
  mosaic: boolean;
  stitches: boolean;
  /** оформление (src/engine/looks.ts): канва и рамка; нет — кремовая и тёмное дерево */
  canvas?: CanvasLook;
  frame?: FrameLook;
}

/** PNG готовой работы; Skia не смогла — null. */
export function shareImage(p: Pattern, stitched: Uint8Array, look: ShareLook,
  fonts: { title: SkFont; text: SkFont; digits: SkFont }, text: ShareText): Uint8Array | null {
  const canvas = look.canvas ?? CANVASES[0];
  const frame = look.frame ?? FRAMES[0];
  const hoop = frame.kind === 'hoop';
  const L = shareLayout(p.w, p.h, hoop);
  const { cell, work: wr } = L;
  const surface = Skia.Surface.Make(L.width, L.height);
  const effect = canvasEffect();
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
  const f = L.frame;
  const mt = L.mat;
  if (hoop) {
    // пяльцы: светлый обод из двух колец, шов между ними, круг ткани; латунный винт — сверху
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    c.drawCircle(cx, cy, f.w / 2, paint(frame.light));
    const seam = paint(frame.dark);
    seam.setStyle(1);
    seam.setStrokeWidth(3);
    seam.setAlphaf(0.55);
    c.drawCircle(cx, cy, f.w / 2 - HOOP_RING / 2, seam);
    const hex = `#${canvas.cloth.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
    c.drawCircle(cx, cy, mt.w / 2, paint(hex));
    const clasp = Skia.RRectXY(Skia.XYWHRect(cx - 26, f.y - 12, 52, 28), 6, 6);
    c.drawRRect(clasp, paint('#c9b98f'));
    const rim = paint(frame.dark);
    rim.setStyle(1);
    rim.setStrokeWidth(3);
    c.drawRRect(clasp, rim);
  } else {
    // рамка со скосом: грани к свету — сверху и слева, в тени — снизу и справа; внутри — бумажное паспарту
    c.drawRect(rect(f), paint(frame.dark));
    const lit = Skia.Path.Make();
    lit.moveTo(f.x, f.y);
    lit.lineTo(f.x + f.w, f.y);
    lit.lineTo(mt.x + mt.w, mt.y);
    lit.lineTo(mt.x, mt.y);
    lit.lineTo(mt.x, mt.y + mt.h);
    lit.lineTo(f.x, f.y + f.h);
    lit.close();
    c.drawPath(lit, paint(frame.light));
    c.drawRect(rect(mt), paint(SHARE_COLORS.mat));
    if (frame.inner) {
      // золочение багета — тонкой полоской по внутреннему краю рамки
      const gilt = paint(frame.inner);
      gilt.setStyle(1);
      gilt.setStrokeWidth(4);
      c.drawRect(Skia.XYWHRect(mt.x - 2, mt.y - 2, mt.w + 4, mt.h + 4), gilt);
    }
  }

  // работа — тем же шейдером, что канва: стежками — если включены и клетка крупная, иначе цветом
  const m = Skia.Matrix();
  m.translate(wr.x, wr.y);
  m.scale(cell, cell);
  const shader = effect.makeShaderWithChildren(uniformList({
    w: p.w, h: p.h, gw: GLYPH_W, gh: GLYPH_H, cellPx: cell, near: shareStitches(cell, look.stitches) ? 1 : 0, selected: -1,
    mosaic: look.mosaic ? 1 : 0, hatch: 0, gap: 0.5 / cell, px0: -1, py0: -1, px1: -1, py1: -1, pulseT: -1, ...NO_SCENE,
    ...canvasUniforms(canvas, hoop),
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
