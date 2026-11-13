// «Светлица» (1.1.0, docs/specs/2026-11-svetlitsa.md): стена комнаты с готовыми работами — рушник по верху, пол
// внизу, работы в рамах на гвоздях с табличками. Стена — та, что выбрана в «Рамках и стенах»; без купленной —
// своя, бесплатная: беленая стена светлицы. Рамы, паспарту, пяльцы, тени и гвозди — те же функции, что у
// «Готово» (src/render/scene.ts). Раскладка — src/engine/gallery.ts. `k` — точек на dp.
import { BlurStyle, ClipOp, FilterMode, ImageFormat, MipmapMode, PaintStyle, Skia, type SkCanvas, type SkFont, type SkImage, type SkPaint, TileMode } from '@shopify/react-native-skia';
import { type Hung, openingOf, pictureIn, ROOM } from '../engine/gallery';
import type { FrameLook, WallLook } from '../engine/looks';
import type { Rect } from '../engine/scene';
import { logError } from '../state/crashlog';
import { drawFrame, drawHanging, drawHoop, drawMat, drawShadow, drawWall } from './scene';

/** Беленая стена светлицы, рушник и пол — свои цвета рисунка, в обеих темах одни. */
const ROOM_COLORS = {
  lime: '#efe8da',
  limeShade: '#d8ccb4',
  linen: '#f4efe4',
  kumach: '#b3162f',
  floor: '#8f6440',
  floorLight: '#a87a52',
  floorSeam: '#5e3f25',
  plinth: '#6b4a2d',
  plaque: '#f4efe4',
  plaqueText: '#2d302e',
  mark: '#f4efe4',
} as const;

const paint = (hex: string, alpha = 1): SkPaint => {
  const p = Skia.Paint();
  p.setColor(Skia.Color(hex));
  p.setAntiAlias(true);
  if (alpha < 1) p.setAlphaf(alpha);
  return p;
};
const rr = (r: Rect) => Skia.XYWHRect(r.x, r.y, r.w, r.h);
const sc = (r: Rect, k: number): Rect => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });

/** Узор рушника: ромб с крестом посередине, 9 × 7 клеток; «x» — крестик кумачом. */
const MOTIF = [
  '....x....',
  '...x.x...',
  '..x.x.x..',
  '.x.xxx.x.',
  '..x.x.x..',
  '...x.x...',
  '....x....',
];

/** Рушник по верху стены: льняная полоса, по краям — две нитки кумача, посередине — ромбы крестиком. */
function drawBand(c: SkCanvas, W: number, k: number): void {
  const h = ROOM.band * k;
  const shadow = paint('#1c140c', 0.18);
  shadow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 3 * k, true));
  c.drawRect(Skia.XYWHRect(0, h - 1 * k, W, 4 * k), shadow);
  c.drawRect(Skia.XYWHRect(0, 0, W, h), paint(ROOM_COLORS.linen));
  c.drawRect(Skia.XYWHRect(0, 3 * k, W, 1.6 * k), paint(ROOM_COLORS.kumach));
  c.drawRect(Skia.XYWHRect(0, h - 4.6 * k, W, 1.6 * k), paint(ROOM_COLORS.kumach));
  const cell = 2.4 * k;
  const mw = MOTIF[0].length * cell;
  const top = (h - MOTIF.length * cell) / 2;
  const x = Skia.Paint();
  x.setColor(Skia.Color(ROOM_COLORS.kumach));
  x.setAntiAlias(true);
  x.setStyle(PaintStyle.Stroke);
  x.setStrokeWidth(Math.max(1, 0.7 * k));
  for (let ox = (W % (mw + cell)) / 2 - mw; ox < W; ox += mw + cell) {
    MOTIF.forEach((line, y) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== 'x') continue;
        const cx = ox + i * cell;
        const cy = top + y * cell;
        c.drawLine(cx + 0.3 * cell, cy + 0.3 * cell, cx + 0.7 * cell, cy + 0.7 * cell, x);
        c.drawLine(cx + 0.7 * cell, cy + 0.3 * cell, cx + 0.3 * cell, cy + 0.7 * cell, x);
      }
    });
  }
}

/** Пол: широкие доски вдоль стены, плинтус, свет к стене. */
function drawFloor(c: SkCanvas, W: number, H: number, k: number): void {
  const fh = ROOM.floor * k;
  const y = H - fh;
  c.drawRect(Skia.XYWHRect(0, y, W, fh), paint(ROOM_COLORS.floor));
  const bh = fh / 3;
  for (let i = 0; i < 3; i++) {
    const g = Skia.Paint();
    g.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: y + i * bh }, { x: 0, y: y + (i + 1) * bh },
      [Skia.Color(ROOM_COLORS.floorLight), Skia.Color(ROOM_COLORS.floor)], null, TileMode.Clamp));
    c.drawRect(Skia.XYWHRect(0, y + i * bh, W, bh), g);
    c.drawRect(Skia.XYWHRect(0, y + (i + 1) * bh - 1 * k, W, 1 * k), paint(ROOM_COLORS.floorSeam, 0.7));
    // торцы досок — вразбежку
    for (let x = ((i * 97) % 140) * k; x < W; x += 140 * k) c.drawRect(Skia.XYWHRect(x, y + i * bh, 1 * k, bh), paint(ROOM_COLORS.floorSeam, 0.6));
  }
  const grain = Skia.Paint();
  grain.setShader(Skia.Shader.MakeFractalNoise(0.004 / k, 0.3 / k, 3, 11, 0, 0));
  grain.setColorFilter(Skia.ColorFilter.MakeMatrix([0, 0, 0, 0, 0.2, 0, 0, 0, 0, 0.12, 0, 0, 0, 0, 0.06, 0, 0, 0, 0.4, 0]));
  c.drawRect(Skia.XYWHRect(0, y, W, fh), grain);
  const far = Skia.Paint();
  far.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y }, { x: 0, y: H },
    [Skia.Color('rgba(0, 0, 0, 0.28)'), Skia.Color('rgba(0, 0, 0, 0)')], null, TileMode.Clamp));
  c.drawRect(Skia.XYWHRect(0, y, W, fh), far);
  c.drawRect(Skia.XYWHRect(0, y - 6 * k, W, 6 * k), paint(ROOM_COLORS.plinth));
  c.drawRect(Skia.XYWHRect(0, y - 6 * k, W, 1.2 * k), paint('#ffffff', 0.18));
}

/** Беленая стена: ровная известь с лёгкой неровностью, свет из окна сверху слева, к полу — тень. */
function drawLime(c: SkCanvas, W: number, H: number, k: number): void {
  c.drawRect(Skia.XYWHRect(0, 0, W, H), paint(ROOM_COLORS.lime));
  const lumps = Skia.Paint();
  lumps.setShader(Skia.Shader.MakeFractalNoise(0.02 / k, 0.02 / k, 4, 5, 0, 0));
  lumps.setColorFilter(Skia.ColorFilter.MakeMatrix([0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0.48, 0, 0, 0, 0, 0.36, 0, 0, 0, 0.18, 0]));
  c.drawRect(Skia.XYWHRect(0, 0, W, H), lumps);
  const sun = Skia.Paint();
  sun.setShader(Skia.Shader.MakeRadialGradient({ x: W * 0.15, y: H * 0.05 }, Math.max(W, H) * 1.05,
    [Skia.Color('rgba(255, 246, 220, 0.45)'), Skia.Color('rgba(255, 246, 220, 0)'), Skia.Color('rgba(70, 50, 30, 0.22)')], [0, 0.55, 1], TileMode.Clamp));
  c.drawRect(Skia.XYWHRect(0, 0, W, H), sun);
}

/** Комната целиком: стена (выбранная или беленая), рушник, пол. */
export function drawRoom(c: SkCanvas, wall: WallLook, W: number, H: number, k: number): void {
  if (wall.id === 'plain') drawLime(c, W, H, k);
  else drawWall(c, wall, W, H, k);
  drawBand(c, W, k);
  drawFloor(c, W, H, k);
}

/** Работа на стене: рама из «Рамок и стен», паспарту, ткань канвы работы, сама работа, табличка с названием. */
export interface Piece {
  hung: Hung;
  look: FrameLook;
  mat: boolean;
  /** ткань канвы работы, #rrggbb */
  cloth: string;
  /** работа целиком (src/render/preview.ts, `previewImage`); нет — пустая ткань */
  picture: SkImage | null;
  /** узор, клеток */
  w: number;
  h: number;
  title: string;
}

/** Строка в ширину `max` точек: длиннее — обрезается с многоточием. */
function fit(s: string, font: SkFont, max: number): string {
  if (font.getTextWidth(s) <= max) return s;
  let n = s.length;
  while (n > 1 && font.getTextWidth(`${s.slice(0, n).trimEnd()}…`) > max) n--;
  return `${s.slice(0, n).trimEnd()}…`;
}

export function drawPiece(c: SkCanvas, p: Piece, k: number, font: SkFont | null): void {
  const hoop = p.look.kind === 'hoop';
  const frame = sc(p.hung.frame, k);
  const { mat, cloth } = openingOf(p.hung.frame, p.look, p.mat);
  const m = sc(mat, k);
  const cl = sc(cloth, k);
  drawShadow(c, frame, hoop, k * 0.6, 0.4);
  drawHanging(c, { x: p.hung.nail.x * k, y: p.hung.nail.y * k }, frame, p.look, k * 0.6);
  if (hoop) drawHoop(c, frame, cl, p.look, k * 0.6, p.cloth);
  else {
    drawFrame(c, frame, m, p.look, k * 0.6);
    if (p.mat) drawMat(c, m, cl, k * 0.6);
    c.drawRect(rr(cl), paint(p.cloth));
  }
  if (p.picture) {
    const at = sc(pictureIn(cloth, p.w, p.h, hoop), k);
    c.save();
    if (hoop) {
      const clip = Skia.Path.Make();
      clip.addOval(rr(cl));
      c.clipPath(clip, ClipOp.Intersect, true);
    }
    const img = p.picture;
    // крупнее своих точек — клетками, без размытия; мельче — с усреднением
    const up = at.w >= img.width();
    c.drawImageRectOptions(img, Skia.XYWHRect(0, 0, img.width(), img.height()), rr(at), up ? FilterMode.Nearest : FilterMode.Linear, MipmapMode.None, null);
    c.restore();
  }
  // ткань — в тени рамы по верхнему и левому краю
  if (!hoop) {
    const inset = Skia.Paint();
    inset.setColor(Skia.Color('rgba(20, 14, 8, 0.35)'));
    inset.setStyle(PaintStyle.Stroke);
    inset.setStrokeWidth(1.2 * k);
    inset.setAntiAlias(true);
    c.drawLine(cl.x, cl.y + 0.6 * k, cl.x + cl.w, cl.y + 0.6 * k, inset);
    c.drawLine(cl.x + 0.6 * k, cl.y, cl.x + 0.6 * k, cl.y + cl.h, inset);
  }
  if (font) {
    const pl = sc(p.hung.plaque, k);
    const text = fit(p.title, font, pl.w - 10 * k);
    const tw = font.getTextWidth(text);
    const w = Math.min(pl.w, tw + 14 * k);
    const box = { x: pl.x + (pl.w - w) / 2, y: pl.y, w, h: pl.h };
    const sh = paint('#1c140c', 0.22);
    sh.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 1.5 * k, true));
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(box.x + 0.8 * k, box.y + 1.2 * k, box.w, box.h), 2 * k, 2 * k), sh);
    c.drawRRect(Skia.RRectXY(rr(box), 2 * k, 2 * k), paint(ROOM_COLORS.plaque));
    c.drawText(text, box.x + (box.w - tw) / 2, box.y + box.h * 0.5 + font.getSize() * 0.36, paint(ROOM_COLORS.plaqueText), font);
  }
}

/** Шрифт табличек — 10 dp. */
export const PLAQUE_DP = 10;

/**
 * Стена с работами картинкой Skia `W` × `H` dp при `k` точках на dp. `skip` — работа, которую не рисовать: она
 * повиснет поверх отдельной картинкой (`pieceImage`), когда её только что вышили. `mark` — строка на полу справа:
 * «Вышито в „Узорах“» на картинке «Поделиться».
 */
export function wallImage(o: { W: number; H: number; k: number; wall: WallLook; pieces: readonly Piece[]; font: SkFont | null; skip?: string; mark?: string }): SkImage | null {
  try {
    const surface = Skia.Surface.Make(Math.max(1, Math.round(o.W * o.k)), Math.max(1, Math.round(o.H * o.k)));
    if (!surface) return null;
    const c = surface.getCanvas();
    o.font?.setSize(PLAQUE_DP * o.k);
    drawRoom(c, o.wall, o.W * o.k, o.H * o.k, o.k);
    for (const p of o.pieces) if (p.hung.id !== o.skip) drawPiece(c, p, o.k, o.font);
    if (o.mark && o.font) {
      o.font.setSize(13 * o.k);
      const tw = o.font.getTextWidth(o.mark);
      c.drawText(o.mark, o.W * o.k - tw - ROOM.pad * o.k, (o.H - ROOM.floor / 2 + 5) * o.k, paint(ROOM_COLORS.mark, 0.9), o.font);
      o.font.setSize(PLAQUE_DP * o.k);
    }
    surface.flush();
    return surface.makeImageSnapshot();
  } catch (e) {
    logError('render', e, 'svetlitsa wall');
    return null;
  }
}

export const wallUri = (img: SkImage | null) => (img ? `data:image/png;base64,${img.encodeToBase64(ImageFormat.PNG, 100)}` : null);
export const wallPng = (img: SkImage | null) => (img ? img.encodeToBytes(ImageFormat.PNG, 100) : null);

/** Поле вокруг рамы у отдельной картинки работы: гвоздь сверху, тень и табличка снизу. */
export const PIECE_PAD = { x: 14, top: ROOM.hang + 4, bottom: ROOM.plaque + 10 } as const;

/** Одна работа на прозрачном фоне — та, что только что повисла: её область — рама с полем `PIECE_PAD`. */
export function pieceUri(p: Piece, k: number, font: SkFont | null): { uri: string | null; at: Rect } {
  const f = p.hung.frame;
  const at = { x: f.x - PIECE_PAD.x, y: f.y - PIECE_PAD.top, w: f.w + 2 * PIECE_PAD.x, h: f.h + PIECE_PAD.top + PIECE_PAD.bottom };
  const plaque = p.hung.plaque;
  at.x = Math.min(at.x, plaque.x - 4);
  at.w = Math.max(at.x + at.w, plaque.x + plaque.w + 4) - at.x;
  try {
    const surface = Skia.Surface.Make(Math.max(1, Math.round(at.w * k)), Math.max(1, Math.round(at.h * k)));
    if (!surface) return { uri: null, at };
    const c = surface.getCanvas();
    c.clear(Skia.Color('rgba(0, 0, 0, 0)'));
    c.translate(-at.x * k, -at.y * k);
    font?.setSize(PLAQUE_DP * k);
    drawPiece(c, p, k, font);
    surface.flush();
    return { uri: wallUri(surface.makeImageSnapshot()), at };
  } catch (e) {
    logError('render', e, 'svetlitsa piece');
    return { uri: null, at };
  }
}
