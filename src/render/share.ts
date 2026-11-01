// «Поделиться» (docs/08-game-design.md, «Готово»; docs/specs/2026-09-library.md, «Готово»):
// готовая работа тем же шейдером, что канва, — ровными клетками цвета или, по настройке, стежками
// выбранного стиля, — в рамке на льняном фоне или (с 0.21.0) на стене, под рамкой — название, подпись
// картины и мелко «Вышито в „Узорах“». Рама, паспарту, пяльцы с бантом, стена, гвоздь — та же сцена, что на
// «Готово» (src/render/scene.ts). Сторона — до 2000 точек.
// Где что лежит и каких цветов — src/engine/share.ts: по нему же сценарий проверяет картинку.
import { ImageFormat, Skia, type SkFont, TileMode, FilterMode, MipmapMode } from '@shopify/react-native-skia';
import { canvasEffect } from '../canvas/effect';
import { canvasUniforms, NO_SCENE, uniformList } from '../canvas/shader';
import { cellBytes, digitAtlas, GLYPH_H, GLYPH_W, paletteImage, rgbaImage } from '../canvas/textures';
import { CANVASES, type CanvasLook, FRAMES, type FrameLook, WALLS, type WallLook } from '../engine/looks';
import type { Pattern } from '../engine/pattern';
import { SHARE_COLORS, shareLayout, type ShareRect, shareStitches } from '../engine/share';
import { drawFrame, drawHanging, drawHoop, drawMat, drawShadow, drawWall } from './scene';

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
  /** стена (0.21.0); нет — льняной фон */
  wall?: WallLook;
  /** паспарту (0.21.0); нет — с паспарту, как до 0.21.0 */
  mat?: boolean;
}

/** PNG готовой работы; Skia не смогла — null. */
export function shareImage(p: Pattern, stitched: Uint8Array, look: ShareLook,
  fonts: { title: SkFont; text: SkFont; digits: SkFont }, text: ShareText): Uint8Array | null {
  const canvas = look.canvas ?? CANVASES[0];
  const frame = look.frame ?? FRAMES[0];
  const wall = look.wall ?? WALLS[0];
  const withMat = look.mat !== false;
  const hoop = frame.kind === 'hoop';
  const L = shareLayout(p.w, p.h, hoop, { mat: withMat, carved: !!frame.carved });
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
  const cloth = `#${canvas.cloth.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
  drawWall(c, wall, L.width, L.height, L.k, SHARE_COLORS.background);
  const f = L.frame;
  const mt = L.mat;
  const onWall = wall.id !== 'plain';
  if (onWall) {
    // на стене: тень и гвоздь с бечёвкой (у пялец — лентой); на льняном фоне — как до 0.21.0, без них
    drawShadow(c, f, hoop, L.k, 0.4);
    drawHanging(c, { x: f.x + f.w / 2, y: f.y - 23 * L.k }, f, frame, L.k);
  }
  if (hoop) drawHoop(c, f, mt, frame, L.k, cloth);
  else {
    // рамка со скосом; внутри — бумажное паспарту со скосом или, без него, поле ткани канвы
    drawFrame(c, f, mt, frame, L.k);
    if (withMat) drawMat(c, mt, wr, L.k);
    else c.drawRect(rect(mt), paint(cloth));
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

  // подпись по центру под рамкой; на стене — на светлой табличке
  if (onWall) {
    const top = L.title - 56;
    const bottom = (text.caption ? L.mark : L.markAlone) + 22;
    const widest = Math.max(fonts.title.getTextWidth(text.title), text.caption ? fonts.text.getTextWidth(text.caption) : 0, fonts.text.getTextWidth(text.mark));
    const pw = Math.min(L.width - 24, widest + 96);
    const plaque = paint(SHARE_COLORS.plaque);
    plaque.setAlphaf(0.94);
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect((L.width - pw) / 2, top, pw, bottom - top), 14, 14), plaque);
  }
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
