// Сцена готовой работы (0.21.0; владелец 01.11.2026: «делай А, Б, В, Г и Д»): стена, тень, рама со скосом
// (резная — с волокном дерева и розетками по углам), паспарту со скосом, пяльцы с бантом на винте, гвоздь с
// бечёвкой. Одни и те же функции рисуют «Готово» (картинкой под канвой, src/screens/DoneScreen.tsx),
// «Поделиться» (src/render/share.ts) и образцы на экране рамок. `k` — точек на dp: у «Поделиться» — 1.
// Раскладка — src/engine/scene.ts и src/engine/share.ts.
import { BlurStyle, ClipOp, ImageFormat, PaintStyle, Skia, type SkCanvas, type SkPaint, StrokeCap, TileMode } from '@shopify/react-native-skia';
import { CANVASES, type FrameLook, type WallLook } from '../engine/looks';
import type { Rect } from '../engine/scene';
import { twinePoints } from '../engine/scene';
import { logError } from '../state/crashlog';

/** Бумага паспарту — как у картинки «Поделиться» до 0.21.0 (src/engine/share.ts, SHARE_COLORS.mat). */
export const MAT_PAPER = '#f7f7f2';
/** Скос паспарту: верх и лево — в тени, низ и право — к свету. */
const MAT_BEVEL = { shade: '#dcd8cc', lit: '#ffffff' } as const;
/** Латунный винт пялец — как до 0.21.0 (сценарий ищет его над ободом). */
export const HOOP_CLASP = '#c9b98f';
const TWINE = '#d8c59a';
const NAIL = '#4a4a48';

const paint = (hex: string, alpha = 1): SkPaint => {
  const p = Skia.Paint();
  p.setColor(Skia.Color(hex));
  p.setAntiAlias(true);
  if (alpha < 1) p.setAlphaf(alpha);
  return p;
};
const stroke = (hex: string, width: number, alpha = 1): SkPaint => {
  const p = paint(hex, alpha);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  return p;
};
const rr = (r: Rect) => Skia.XYWHRect(r.x, r.y, r.w, r.h);

/** Стена во весь `w` × `h`. Без стены — фон `plain`: у «Готово» его рисует тема, у «Поделиться» — льняной. */
export function drawWall(c: SkCanvas, wall: WallLook, w: number, h: number, k: number, plain?: string): void {
  if (wall.id === 'plain') {
    if (plain) c.drawRect(Skia.XYWHRect(0, 0, w, h), paint(plain));
    return;
  }
  c.drawRect(Skia.XYWHRect(0, 0, w, h), paint(wall.base));
  if (wall.id === 'izba') {
    // брёвна: каждое — круглое (свет посередине), между ними — тёмный шов мха; волокно — шумом вдоль бревна
    const lh = 44 * k;
    for (let y = -lh / 3, i = 0; y < h; y += lh, i++) {
      const g = Skia.Paint();
      g.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y }, { x: 0, y: y + lh },
        [Skia.Color(wall.shade), Skia.Color(wall.light), Skia.Color(wall.base), Skia.Color(wall.shade)], [0, 0.35, 0.7, 1], TileMode.Clamp));
      c.drawRect(Skia.XYWHRect(0, y, w, lh), g);
      c.drawRect(Skia.XYWHRect(0, y + lh - 2.5 * k, w, 2.5 * k), paint('#3c2a19', 0.75));
      // торец бревна в углу — через ряд, чередуясь
      const ex = i % 2 ? w - 10 * k : -lh * 0.62;
      c.drawOval(Skia.XYWHRect(ex, y + lh * 0.08, lh * 0.75, lh * 0.84), paint('#c9a274'));
      c.drawOval(Skia.XYWHRect(ex + lh * 0.2, y + lh * 0.3, lh * 0.32, lh * 0.36), stroke('#8a6440', 1.2 * k, 0.6));
    }
    const grain = Skia.Paint();
    grain.setShader(Skia.Shader.MakeFractalNoise(0.006 / k, 0.22 / k, 3, 7, 0, 0));
    grain.setColorFilter(Skia.ColorFilter.MakeMatrix([0, 0, 0, 0, 0.24, 0, 0, 0, 0, 0.15, 0, 0, 0, 0, 0.08, 0, 0, 0, 0.55, 0]));
    c.drawRect(Skia.XYWHRect(0, 0, w, h), grain);
    // тёплый свет лампы сверху слева, углы — в тени
    const lamp = Skia.Paint();
    lamp.setShader(Skia.Shader.MakeRadialGradient({ x: w * 0.3, y: h * 0.12 }, Math.max(w, h) * 0.95,
      [Skia.Color('rgba(255, 242, 200, 0.32)'), Skia.Color('rgba(0, 0, 0, 0.38)')], null, TileMode.Clamp));
    c.drawRect(Skia.XYWHRect(0, 0, w, h), lamp);
  } else if (wall.id === 'city') {
    // обои: тонкие полосы и ромбики-цветы в шахматном порядке, книзу — чуть темнее
    const sw = 22 * k;
    for (let x = 0; x < w; x += 2 * sw) c.drawRect(Skia.XYWHRect(x, 0, sw * 0.18, h), paint(wall.light, 0.22));
    const cell = 34 * k;
    const motif = paint(wall.light, 0.55);
    for (let y = 0, row = 0; y < h + cell; y += cell, row++) {
      for (let x = (row % 2) * (cell / 2); x < w + cell; x += cell) {
        const m = Skia.Path.Make();
        m.moveTo(x, y - 6 * k);
        m.lineTo(x + 5 * k, y);
        m.lineTo(x, y + 6 * k);
        m.lineTo(x - 5 * k, y);
        m.close();
        c.drawPath(m, motif);
        c.drawCircle(x, y - 9 * k, 1.6 * k, motif);
        c.drawCircle(x, y + 9 * k, 1.6 * k, motif);
      }
    }
    const down = Skia.Paint();
    down.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: 0, y: h },
      [Skia.Color('rgba(255, 255, 255, 0.10)'), Skia.Color('rgba(20, 30, 20, 0.28)')], null, TileMode.Clamp));
    c.drawRect(Skia.XYWHRect(0, 0, w, h), down);
  } else {
    // дача: вертикальная вагонка, швы — тенью, свет из окна слева сверху
    const bw = 30 * k;
    for (let x = 0, i = 0; x < w; x += bw, i++) {
      c.drawRect(Skia.XYWHRect(x, 0, bw, h), paint(i % 2 ? wall.base : wall.light, i % 2 ? 1 : 0.55));
      c.drawRect(Skia.XYWHRect(x + bw - 1.6 * k, 0, 1.6 * k, h), paint(wall.shade, 0.9));
      if (i % 3 === 1) c.drawOval(Skia.XYWHRect(x + bw * 0.35, (h * ((i * 37) % 100)) / 100, 6 * k, 9 * k), paint(wall.shade, 0.5));
    }
    const sun = Skia.Paint();
    sun.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: w, y: h },
      [Skia.Color('rgba(255, 252, 235, 0.45)'), Skia.Color('rgba(255, 252, 235, 0)'), Skia.Color('rgba(60, 50, 30, 0.18)')], [0, 0.5, 1], TileMode.Clamp));
    c.drawRect(Skia.XYWHRect(0, 0, w, h), sun);
  }
}

/** Тень рамы или пялец на стене: размытый тёмный силуэт, чуть ниже и правее. */
export function drawShadow(c: SkCanvas, r: Rect, round: boolean, k: number, alpha = 0.35): void {
  const p = paint('#1c140c', alpha);
  p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 8 * k, true));
  const s = { x: r.x + 4 * k, y: r.y + 8 * k, w: r.w, h: r.h };
  if (round) c.drawOval(rr(s), p);
  else c.drawRect(rr(s), p);
}

/**
 * Рама со скосом между `frame` и `inner`: верх и лево — к свету, низ и право — в тени, ровными цветами (их
 * ищет сценарий). У багета и резной — золочение по внутреннему краю; у резной — волокно дерева вдоль граней и
 * розетки по углам.
 */
export function drawFrame(c: SkCanvas, frame: Rect, inner: Rect, look: FrameLook, k: number): void {
  c.drawRect(rr(frame), paint(look.dark));
  const lit = Skia.Path.Make();
  lit.moveTo(frame.x, frame.y);
  lit.lineTo(frame.x + frame.w, frame.y);
  lit.lineTo(inner.x + inner.w, inner.y);
  lit.lineTo(inner.x, inner.y);
  lit.lineTo(inner.x, inner.y + inner.h);
  lit.lineTo(frame.x, frame.y + frame.h);
  lit.close();
  c.drawPath(lit, paint(look.light));
  if (look.carved) {
    // волокно: по верхней и нижней граням — вдоль, по боковым — поперёк; только по дереву, не в окне
    const t = inner.x - frame.x;
    const along = (r: Rect, fx: number, fy: number, seed: number) => {
      c.save();
      c.clipRect(rr(r), ClipOp.Intersect, true);
      const g = Skia.Paint();
      g.setShader(Skia.Shader.MakeFractalNoise(fx / k, fy / k, 3, seed, 0, 0));
      g.setColorFilter(Skia.ColorFilter.MakeMatrix([0, 0, 0, 0, 0.2, 0, 0, 0, 0, 0.12, 0, 0, 0, 0, 0.06, 0, 0, 0, 0.7, 0]));
      c.drawRect(rr(r), g);
      c.restore();
    };
    along({ x: frame.x, y: frame.y, w: frame.w, h: t }, 0.012, 0.25, 3);
    along({ x: frame.x, y: inner.y + inner.h, w: frame.w, h: t }, 0.012, 0.25, 5);
    along({ x: frame.x, y: inner.y, w: t, h: inner.h }, 0.25, 0.012, 7);
    along({ x: inner.x + inner.w, y: inner.y, w: t, h: inner.h }, 0.25, 0.012, 9);
    // резной валик по наружному краю
    const bead = stroke('#2c1b0f', 1.4 * k, 0.6);
    bead.setPathEffect(Skia.PathEffect.MakeDash([1.5 * k, 3.5 * k], 0));
    c.drawRect(Skia.XYWHRect(frame.x + t * 0.28, frame.y + t * 0.28, frame.w - t * 0.56, frame.h - t * 0.56), bead);
    // розетки по углам: тёмный круг, восемь лепестков, золочёная серединка
    const rosette = (cx: number, cy: number) => {
      const r = t * 0.42;
      c.drawCircle(cx, cy, r, paint('#4a2e1a'));
      for (let a = 0; a < 8; a++) {
        const ang = (a * Math.PI) / 4;
        const px = cx + Math.cos(ang) * r * 0.55;
        const py = cy + Math.sin(ang) * r * 0.55;
        c.save();
        c.translate(px, py);
        c.rotate(a * 45, 0, 0);
        c.drawOval(Skia.XYWHRect(-r * 0.32, -r * 0.17, r * 0.64, r * 0.34), paint('#8a5d36'));
        c.restore();
      }
      c.drawCircle(cx, cy, r * 0.24, paint(look.inner ?? '#d6b260'));
    };
    rosette(frame.x + t / 2, frame.y + t / 2);
    rosette(frame.x + frame.w - t / 2, frame.y + t / 2);
    rosette(frame.x + t / 2, frame.y + frame.h - t / 2);
    rosette(frame.x + frame.w - t / 2, frame.y + frame.h - t / 2);
  }
  if (look.inner) {
    // золочение — тонкой полоской по внутреннему краю рамы
    c.drawRect(Skia.XYWHRect(inner.x - 1.5 * k, inner.y - 1.5 * k, inner.w + 3 * k, inner.h + 3 * k), stroke(look.inner, 2.5 * k));
  }
}

/** Паспарту: бумага между `mat` и окном `opening`, по краю окна — скос: верх и лево в тени, низ и право — к свету. */
export function drawMat(c: SkCanvas, mat: Rect, opening: Rect, k: number): void {
  c.drawRect(rr(mat), paint(MAT_PAPER));
  const b = Math.max(1, 3 * k);
  const o = opening;
  const face = (pts: [number, number][], hex: string) => {
    const p = Skia.Path.Make();
    p.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) p.lineTo(x, y);
    p.close();
    c.drawPath(p, paint(hex));
  };
  face([[o.x - b, o.y - b], [o.x + o.w + b, o.y - b], [o.x + o.w, o.y], [o.x, o.y]], MAT_BEVEL.shade);
  face([[o.x - b, o.y - b], [o.x, o.y], [o.x, o.y + o.h], [o.x - b, o.y + o.h + b]], MAT_BEVEL.shade);
  face([[o.x + o.w + b, o.y - b], [o.x + o.w + b, o.y + o.h + b], [o.x + o.w, o.y + o.h], [o.x + o.w, o.y]], MAT_BEVEL.lit);
  face([[o.x - b, o.y + o.h + b], [o.x, o.y + o.h], [o.x + o.w, o.y + o.h], [o.x + o.w + b, o.y + o.h + b]], MAT_BEVEL.lit);
}

/**
 * Пяльцы: обод из двух колец со швом вокруг круга ткани `cloth` (0xRRGGBB → hex), латунный винт сверху и, с
 * 0.21.0, бант ленты над винтом: концы ленты лежат снаружи обода. `fabric` — рисовать ли круг ткани (у
 * «Готово» его рисует канва).
 */
export function drawHoop(c: SkCanvas, frame: Rect, inner: Rect, look: FrameLook, k: number, fabric?: string): void {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  c.drawCircle(cx, cy, frame.w / 2, paint(look.light));
  c.drawCircle(cx, cy, (frame.w + inner.w) / 4, stroke(look.dark, 1.5 * k, 0.55));
  if (fabric) c.drawCircle(cx, cy, inner.w / 2, paint(fabric));
  if (look.ribbon) drawBow(c, cx, cy, frame.w / 2, look.ribbon, k);
  const cw = 26 * k;
  const ch = 14 * k;
  const clasp = Skia.RRectXY(Skia.XYWHRect(cx - cw / 2, frame.y - 6 * k, cw, ch), 3 * k, 3 * k);
  c.drawRRect(clasp, paint(HOOP_CLASP));
  c.drawRRect(clasp, stroke(look.dark, 1.5 * k));
}

/**
 * Бант ленты на винте пялец с центром (`cx`, `cy`) и ободом радиуса `r`: узелок над винтом, две петли, концы
 * ленты лежат вдоль обода снаружи и кончаются ласточкиным хвостом. Лента — одной длины при любом ободе: на
 * большой картинке «Поделиться» концы не обегают пол-обода.
 */
function drawBow(c: SkCanvas, cx: number, cy: number, r: number, color: string, k: number): void {
  const x = cx;
  const y = cy - r - 14 * k;
  const polar = (rad: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) };
  };
  // градусы дуги обода длиной `len`
  const arc = (len: number) => (len / r) * (180 / Math.PI);
  const tail = (side: number) => {
    const r1 = r + 2 * k;
    const r2 = r + 11 * k;
    const a0 = -90 + side * arc(20 * k);
    const a1 = a0 + side * arc(116 * k);
    const p = Skia.Path.Make();
    const start = polar(r1, a0);
    p.moveTo(x + side * 2 * k, y + 3 * k);
    p.lineTo(start.x, start.y);
    for (let i = 1; i <= 16; i++) {
      const q = polar(r1, a0 + ((a1 - a0) * i) / 16);
      p.lineTo(q.x, q.y);
    }
    const tip = polar((r1 + r2) / 2, a1 - side * arc(15 * k));
    p.lineTo(tip.x, tip.y);
    const out = polar(r2, a1 + side * arc(9 * k));
    p.lineTo(out.x, out.y);
    for (let i = 15; i >= 0; i--) {
      const q = polar(r2, a0 + ((a1 - a0) * i) / 16);
      p.lineTo(q.x, q.y);
    }
    p.lineTo(x + side * 6 * k, y - 2 * k);
    p.close();
    c.drawPath(p, paint(color));
    c.drawPath(p, stroke('#000000', 0.8 * k, 0.2));
  };
  tail(-1);
  tail(1);
  const loop = (side: number) => {
    const p = Skia.Path.Make();
    p.moveTo(x, y);
    p.cubicTo(x + side * 20 * k, y - 18 * k, x + side * 30 * k, y + 4 * k, x, y);
    p.close();
    c.drawPath(p, paint(color));
    c.drawPath(p, stroke('#000000', 0.8 * k, 0.25));
  };
  loop(-1);
  loop(1);
  c.drawOval(Skia.XYWHRect(x - 6 * k, y - 5 * k, 12 * k, 10 * k), paint(color));
  c.drawOval(Skia.XYWHRect(x - 6 * k, y - 5 * k, 12 * k, 10 * k), stroke('#000000', 0.8 * k, 0.3));
}

/** Гвоздь и бечёвка к раме; у пялец — лента от банта к гвоздю. */
export function drawHanging(c: SkCanvas, nail: { x: number; y: number }, frame: Rect, look: FrameLook, k: number): void {
  if (look.kind === 'hoop') {
    const p = stroke(look.ribbon ?? TWINE, 3 * k);
    p.setStrokeCap(StrokeCap.Round);
    c.drawLine(nail.x, nail.y, nail.x - 6 * k, frame.y - 14 * k, p);
    c.drawLine(nail.x, nail.y, nail.x + 6 * k, frame.y - 14 * k, p);
  } else {
    const [a, b] = twinePoints(frame);
    const p = stroke(TWINE, 1.8 * k);
    p.setStrokeCap(StrokeCap.Round);
    c.drawLine(nail.x, nail.y, a.x, a.y, p);
    c.drawLine(nail.x, nail.y, b.x, b.y, p);
  }
  c.drawCircle(nail.x, nail.y, 3.6 * k, paint(NAIL));
  c.drawCircle(nail.x - 1 * k, nail.y - 1 * k, 1.2 * k, paint('#9a9a96'));
}

/** Сцена «Готово» без канвы: стена, тень, рама или пяльцы, паспарту, гвоздь — картинкой PNG (data: URI). */
export function sceneImage(o: {
  width: number; height: number; k: number;
  frame: Rect; mat: Rect; cloth: Rect; nail?: { x: number; y: number };
  look: FrameLook; wall: WallLook; withMat: boolean;
}): string | null {
  try {
    const W = Math.max(1, Math.round(o.width * o.k));
    const H = Math.max(1, Math.round(o.height * o.k));
    const surface = Skia.Surface.Make(W, H);
    if (!surface) return null;
    const c = surface.getCanvas();
    c.clear(Skia.Color('rgba(0, 0, 0, 0)'));
    const K = o.k;
    const sc = (r: Rect): Rect => ({ x: r.x * K, y: r.y * K, w: r.w * K, h: r.h * K });
    drawWall(c, o.wall, W, H, K);
    const hoop = o.look.kind === 'hoop';
    drawShadow(c, sc(o.frame), hoop, K, o.wall.id === 'plain' ? 0.3 : 0.4);
    if (o.nail) drawHanging(c, { x: o.nail.x * K, y: o.nail.y * K }, sc(o.frame), o.look, K);
    if (hoop) drawHoop(c, sc(o.frame), sc(o.cloth), o.look, K);
    else {
      drawFrame(c, sc(o.frame), sc(o.mat), o.look, K);
      if (o.withMat) drawMat(c, sc(o.mat), sc(o.cloth), K);
    }
    surface.flush();
    return `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 100)}`;
  } catch (e) {
    logError('render', e, 'scene');
    return null;
  }
}

/** Образец на экране рамок: рама (или пяльцы) на стене, в окне — ткань кремовой канвы. */
export function lookSample(look: FrameLook, wall: WallLook, withMat: boolean, width = 150, height = 100, k = 2): string | null {
  const cloth = CANVASES[0].cloth.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  const hoop = look.kind === 'hoop';
  const t = look.carved ? 10 : 6;
  const m = withMat && !hoop ? 8 : 0;
  const hang = wall.id === 'plain' ? 0 : 18;
  const d = Math.min(height - hang - 16, width - 40);
  const frame = hoop
    ? { x: (width - d) / 2, y: (height - d + hang) / 2, w: d, h: d }
    : { x: width * 0.2, y: (height - (height - hang - 22) + hang) / 2, w: width * 0.6, h: height - hang - 22 };
  const inner = hoop ? { x: frame.x + 7, y: frame.y + 7, w: d - 14, h: d - 14 } : { x: frame.x + t, y: frame.y + t, w: frame.w - 2 * t, h: frame.h - 2 * t };
  const opening = { x: inner.x + m, y: inner.y + m, w: inner.w - 2 * m, h: inner.h - 2 * m };
  try {
    const surface = Skia.Surface.Make(width * k, height * k);
    if (!surface) return null;
    const c = surface.getCanvas();
    const sc = (r: Rect): Rect => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
    drawWall(c, wall, width * k, height * k, k * 0.6, '#ecede6');
    drawShadow(c, sc(frame), hoop, k * 0.6, 0.35);
    if (hang) drawHanging(c, { x: (frame.x + frame.w / 2) * k, y: (frame.y - hang * 0.7) * k }, sc(frame), look, k * 0.6);
    if (hoop) drawHoop(c, sc(frame), sc(inner), look, k * 0.6, `#${cloth}`);
    else {
      drawFrame(c, sc(frame), sc(inner), look, k * 0.6);
      if (m) drawMat(c, sc(inner), sc(opening), k * 0.6);
      c.drawRect(rr(sc(opening)), paint(`#${cloth}`));
    }
    surface.flush();
    return `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 100)}`;
  } catch (e) {
    logError('render', e, 'look sample');
    return null;
  }
}
