// Канва вышивания (docs/specs/2026-09-canvas.md): отрисовка одним шейдером или «слоями»,
// камера и кисть — на UI-потоке, в JS уходят только готовые штрихи. React не
// перерисовывается ни на стежок, ни на кадр камеры.
//
// Компилятор React сюда не заходит ("use no memo"): вложенные функции внутри ворклетов
// он выносит наружу, и они падают с «non-worklet function» (docs/02-architecture.md,
// «Ограничения»). Общие значения — через .get() и .set().
import {
  Canvas, FilterMode, MipmapMode, Picture, Skia, TileMode,
  type SkFont, type SkImage, type SkPicture, type SkRSXform, type SkRect, type SkRuntimeEffect, type SkShader,
} from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { PixelRatio } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  cancelAnimation, useDerivedValue, useFrameCallback, useSharedValue, withDecay, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import type { Pattern } from '../engine/pattern';
import { type Camera, clampScale, clampX, clampY, fitScale, MAX_DP, NUMBERS_DP, OPEN_BIG_DP, OPEN_DP } from './camera';
import { SKSL, uniformList } from './shader';
import { cellBytes, digitAtlas, GLYPH_H, GLYPH_W, paletteImage, rgbaImage } from './textures';
import { traverse } from './traverse';

export type RenderPath = 'shader' | 'layers';

/** Что умеет канва по просьбе экрана — из JS. */
export interface CanvasApi {
  /** вышить клетки (заливка, повтор); чужие и вышитые пропускаются */
  stitch(cells: readonly number[]): void;
  /** начать заново: всё невышито (повтор «Как вышивалось») */
  clear(): void;
  /** «Где ещё?»: камера к группе за 400 мс, клетки пульсируют 1,5 с; вернёт, где встанет камера */
  flyTo(g: { cx: number; cy: number; x0: number; y0: number; x1: number; y1: number }): Camera;
  /** где камера сейчас */
  camera(): Camera;
  /** весь узор на экране */
  fit(ms?: number): void;
}

/** Замер (docs/specs/2026-09-spikes.md, П2): что канва делает сама и что меряет. */
export interface BenchScript {
  /** длительность каждой фазы, мс */
  phaseMs: number;
  /** клеток кисти в секунду */
  brushRate: number;
}

export interface BenchResult {
  pan: number[];
  zoom: number[];
  brush: number[];
  /** время обработчика кисти и пересборки текстуры, мс */
  handler: number[];
  texture: number[];
  /** время сборки кадра (картинки Skia), мс */
  build: number[];
  stitches: number;
}

export interface LiveStats {
  fps: number;
  worst: number;
}

interface Props {
  pattern: Pattern;
  /** вышитые клетки на момент открытия */
  stitched: Uint8Array;
  selected: number;
  mosaic: boolean;
  hatch: boolean;
  bigNumbers: boolean;
  fill: boolean;
  font: SkFont;
  width: number;
  height: number;
  path?: RenderPath;
  /** SurfaceView вместо TextureView на Android */
  opaque?: boolean;
  /** без кисти: только камера («Готово», повтор) */
  viewOnly?: boolean;
  /** где открыть: камера из прошлого раза или «весь узор» */
  initial?: Camera | 'fit' | 'open';
  apiRef: { current: CanvasApi | null };
  onStroke?: (thread: number, cells: number[], final: boolean) => void;
  onForeign?: (cell: number) => void;
  onPick?: (cell: number) => void;
  onFill?: (cell: number) => void;
  onCamera?: (c: Camera) => void;
  /** стежок лёг — для звука и вибрации; не чаще 20 раз в секунду */
  onTick?: () => void;
  onLive?: (s: LiveStats) => void;
  script?: BenchScript;
  onScriptDone?: (r: BenchResult) => void;
}

interface Brush {
  active: boolean;
  thread: number;
  /** все клетки штриха — чтобы снять их, если это был масштаб */
  cells: number[];
  /** ещё не отправленные в JS */
  pending: number[];
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startT: number;
  sentT: number;
  moved: boolean;
  /** штрих кончился в первые 100 мс: ждёт, не окажется ли это масштабом двумя пальцами */
  hold: boolean;
  firstCell: number;
  /** далеко: палец двигает канву */
  far: boolean;
  lastTapT: number;
  lastTapCell: number;
}

const HOLD_DP = 6;
const TWO_FINGER_MS = 100;
const DOUBLE_TAP_MS = 250;
const FLUSH_MS = 1000;
/** звук и вибрация стежка — не чаще 20 раз в секунду */
const TICK_MS = 50;

function nowMs(): number {
  'worklet';
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return p && p.now ? p.now() : Date.now();
}

function stitchCell(b: Uint8Array, cell: number, thread: number, any: boolean): boolean {
  'worklet';
  const o = cell * 4;
  if (b[o + 1] !== 0 || b[o] === 255) return false;
  if (!any && b[o] !== thread) return false;
  b[o + 1] = 255;
  return true;
}

function hitCell(x: number, y: number, s: number, tx: number, ty: number, w: number, h: number): number {
  'worklet';
  const cx = Math.floor((x - tx) / s);
  const cy = Math.floor((y - ty) / s);
  return cx < 0 || cy < 0 || cx >= w || cy >= h ? -1 : cy * w + cx;
}

function shaderPicture(
  effect: SkRuntimeEffect, cells: SkImage, pal: SkShader, dig: SkShader, w: number, h: number,
  s: number, tx: number, ty: number, vw: number, vh: number, dpr: number,
  selected: number, mosaic: boolean, hatch: boolean, pulse: number[], pulseT: number,
): SkPicture {
  'worklet';
  const uniforms = uniformList({
    w, h, gw: GLYPH_W, gh: GLYPH_H, cellPx: s * dpr, near: s >= NUMBERS_DP ? 1 : 0, selected,
    mosaic: mosaic ? 1 : 0, hatch: hatch ? 1 : 0, gap: 0.5 / s,
    px0: pulse[0], py0: pulse[1], px1: pulse[2], py1: pulse[3], pulseT,
  });
  const m = Skia.Matrix();
  m.translate(tx, ty);
  m.scale(s, s);
  const cellShader = cells.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None);
  const shader = effect.makeShaderWithChildren(uniforms, [cellShader, pal, dig], m);
  const paint = Skia.Paint();
  paint.setShader(shader);
  const rec = Skia.PictureRecorder();
  const rect = Skia.XYWHRect(0, 0, vw, vh);
  const canvas = rec.beginRecording(rect);
  canvas.drawRect(rect, paint);
  return rec.finishRecordingAsPicture();
}

/** Путь Б — «слои»: цвета картинкой без сглаживания, сетка путём, цифры атласом. */
function layersPicture(
  colors: SkImage, digits: SkImage, bytes: Uint8Array, w: number, h: number,
  s: number, tx: number, ty: number, vw: number, vh: number,
): SkPicture {
  'worklet';
  const rec = Skia.PictureRecorder();
  const view = Skia.XYWHRect(0, 0, vw, vh);
  const canvas = rec.beginRecording(view);
  const bg = Skia.Paint();
  bg.setColor(Skia.Color('#e2e3da'));
  canvas.drawRect(view, bg);
  canvas.drawImageRectOptions(colors, Skia.XYWHRect(0, 0, w, h), Skia.XYWHRect(tx, ty, w * s, h * s), FilterMode.Nearest, MipmapMode.None, null);
  if (s >= NUMBERS_DP) {
    const x0 = Math.max(0, Math.floor(-tx / s));
    const y0 = Math.max(0, Math.floor(-ty / s));
    const x1 = Math.min(w - 1, Math.floor((vw - tx) / s));
    const y1 = Math.min(h - 1, Math.floor((vh - ty) / s));
    const grid = Skia.Path.Make();
    for (let x = x0; x <= x1 + 1; x++) {
      grid.moveTo(tx + x * s, ty + y0 * s);
      grid.lineTo(tx + x * s, ty + (y1 + 1) * s);
    }
    for (let y = y0; y <= y1 + 1; y++) {
      grid.moveTo(tx + x0 * s, ty + y * s);
      grid.lineTo(tx + (x1 + 1) * s, ty + y * s);
    }
    const line = Skia.Paint();
    line.setColor(Skia.Color('rgba(80,84,78,0.35)'));
    line.setStyle(1);
    line.setStrokeWidth(1);
    canvas.drawPath(grid, line);
    const sprites: SkRect[] = [];
    const xf: SkRSXform[] = [];
    const k = (s * 0.7) / GLYPH_H;
    const gw = GLYPH_W * k;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const o = (y * w + x) * 4;
        if (bytes[o + 1] !== 0 || bytes[o] === 255) continue;
        const n = bytes[o] + 1;
        const cx = tx + (x + 0.5) * s;
        const cy = ty + (y + 0.5) * s - (GLYPH_H * k) / 2;
        if (n < 10) {
          sprites.push(Skia.XYWHRect(n * GLYPH_W, 0, GLYPH_W, GLYPH_H));
          xf.push(Skia.RSXform(k, 0, cx - gw / 2, cy));
        } else {
          const tens = Math.floor(n / 10);
          sprites.push(Skia.XYWHRect(tens * GLYPH_W, 0, GLYPH_W, GLYPH_H));
          xf.push(Skia.RSXform(k, 0, cx - gw * 0.96, cy));
          sprites.push(Skia.XYWHRect((n - tens * 10) * GLYPH_W, 0, GLYPH_W, GLYPH_H));
          xf.push(Skia.RSXform(k, 0, cx - gw * 0.04, cy));
        }
      }
    }
    if (sprites.length) {
      const ink = Skia.Paint();
      ink.setColorFilter(Skia.ColorFilter.MakeBlend(Skia.Color('#3b3e3c'), 5));
      canvas.drawAtlas(digits, sprites, xf, ink);
    }
  }
  return rec.finishRecordingAsPicture();
}

/** Цвета клеток для «слоёв»: вышитое — нитью, невышитое — бледным тоном, выбранная — окраской. */
function layerColors(bytes: Uint8Array, rgb: number[], selected: number, out: Uint8Array): void {
  'worklet';
  const n = bytes.length / 4;
  for (let i = 0; i < n; i++) {
    const t = bytes[i * 4];
    const o = i * 4;
    out[o + 3] = 255;
    if (t === 255) {
      out[o] = 243; out[o + 1] = 240; out[o + 2] = 230;
      continue;
    }
    const c = rgb[t];
    const r = (c >> 16) & 255;
    const g = (c >> 8) & 255;
    const b = c & 255;
    if (bytes[o + 1] !== 0) {
      out[o] = r; out[o + 1] = g; out[o + 2] = b;
    } else {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const k = t === selected ? 0.25 : 0;
      out[o] = Math.round((246 * 0.65 + l * 0.35) * (1 - k) + r * k);
      out[o + 1] = Math.round((246 * 0.65 + l * 0.35) * (1 - k) + g * k);
      out[o + 2] = Math.round((242 * 0.65 + l * 0.35) * (1 - k) + b * k);
    }
  }
}

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

export function StitchCanvas(props: Props) {
  'use no memo';
  const { pattern: p, width: vw, height: vh, font, apiRef } = props;
  const w = p.w;
  const h = p.h;
  const dpr = PixelRatio.get();
  const path: RenderPath = props.path ?? 'shader';
  const viewOnly = !!props.viewOnly;

  const res = useMemo(() => {
    const effect = Skia.RuntimeEffect.Make(SKSL);
    const pal = paletteImage(p);
    const digits = digitAtlas(font);
    if (!effect || !pal || !digits) throw new Error('canvas: shader or textures failed');
    return {
      effect,
      digits,
      pal: pal.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None),
      dig: digits.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None),
      rgb: p.threads.map((t) => t.rgb),
    };
  }, [p, font]);

  const start = useMemo(() => {
    const bytes = cellBytes(p, props.stitched);
    const fit = fitScale(w, h, vw, vh);
    let cam: Camera;
    const init = props.initial ?? 'open';
    if (init === 'fit') cam = { s: fit, tx: (vw - w * fit) / 2, ty: (vh - h * fit) / 2 };
    else if (init === 'open') {
      const s = fit >= NUMBERS_DP ? fit : props.bigNumbers ? OPEN_BIG_DP : OPEN_DP;
      cam = { s, tx: clampX((vw - w * s) / 2, s, w, vw), ty: clampY((vh - h * s) / 2, s, h, vh) };
    } else cam = init;
    return { bytes, img: rgbaImage(bytes, w, h), cam };
    // открытие — один раз на узор и размер; дальше клетки живут на UI-потоке
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, vw, vh]);

  const bytes = useSharedValue(start.bytes);
  const img = useSharedValue<SkImage | null>(start.img);
  const colorBytes = useSharedValue(new Uint8Array(w * h * 4));
  const colors = useSharedValue<SkImage | null>(null);
  const s = useSharedValue(start.cam.s);
  const tx = useSharedValue(start.cam.tx);
  const ty = useSharedValue(start.cam.ty);
  const sel = useSharedValue(props.selected);
  const mosaic = useSharedValue(props.mosaic);
  const hatch = useSharedValue(props.hatch);
  const fillOn = useSharedValue(props.fill);
  const pulse = useSharedValue([0, 0, -1, -1]);
  const pulseStart = useSharedValue(-1);
  const clock = useSharedValue(0);
  const brush = useSharedValue<Brush>({
    active: false, thread: -1, cells: [], pending: [], startX: 0, startY: 0, lastX: 0, lastY: 0,
    startT: 0, sentT: 0, moved: false, hold: false, firstCell: -1, far: false, lastTapT: -1e9, lastTapCell: -1,
  });
  const probe = useSharedValue<BenchResult>({ pan: [], zoom: [], brush: [], handler: [], texture: [], build: [], stitches: 0 });
  const phase = useSharedValue(-1);
  const phaseT = useSharedValue(0);
  const live = useSharedValue({ frames: 0, worst: 0, since: 0 });
  const scripted = useSharedValue({ row: -1, x: 0 });

  useEffect(() => { sel.set(props.selected); }, [props.selected, sel]);
  // размер канвы поменялся — камера остаётся в пределах, центр экрана — на той же клетке
  const lastSize = useSharedValue({ vw, vh });
  useEffect(() => {
    const prev = lastSize.get();
    if (prev.vw === vw && prev.vh === vh) return;
    const k = clampScale(s.get(), w, h, vw, vh);
    const cx = (prev.vw / 2 - tx.get()) / s.get();
    const cy = (prev.vh / 2 - ty.get()) / s.get();
    s.set(k);
    tx.set(clampX(vw / 2 - cx * k, k, w, vw));
    ty.set(clampY(vh / 2 - cy * k, k, h, vh));
    lastSize.set({ vw, vh });
  }, [vw, vh, w, h, s, tx, ty, lastSize]);
  useEffect(() => { mosaic.set(props.mosaic); }, [props.mosaic, mosaic]);
  useEffect(() => { hatch.set(props.hatch); }, [props.hatch, hatch]);
  useEffect(() => { fillOn.set(props.fill); }, [props.fill, fillOn]);

  const { onStroke, onForeign, onPick, onFill, onCamera, onTick, onLive, onScriptDone, script } = props;
  const lastTick = useSharedValue(0);

  // «слои»: картинка цветов пересобирается при стежках и смене нити
  const layersOn = path === 'layers';
  const rebuildColors = () => {
    'worklet';
    if (!layersOn) return;
    const out = colorBytes.get();
    layerColors(bytes.get(), res.rgb, sel.get(), out);
    colors.set(rgbaImage(out, w, h));
  };

  const refresh = () => {
    'worklet';
    const t0 = nowMs();
    img.set(rgbaImage(bytes.get(), w, h));
    rebuildColors();
    if (phase.get() >= 0) probe.get().texture.push(nowMs() - t0);
  };

  useEffect(() => {
    if (layersOn) scheduleOnUI(rebuildColors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layersOn, props.selected]);

  // Кадр: картинка Skia пересобирается, когда меняется камера, клетки или нить.
  const picture = useDerivedValue(() => {
    const t0 = nowMs();
    const cam = { s: s.get(), tx: tx.get(), ty: ty.get() };
    let pic: SkPicture;
    if (layersOn) {
      const c = colors.get();
      if (!c) {
        const rec = Skia.PictureRecorder();
        rec.beginRecording(Skia.XYWHRect(0, 0, vw, vh));
        pic = rec.finishRecordingAsPicture();
      } else pic = layersPicture(c, res.digits, bytes.get(), w, h, cam.s, cam.tx, cam.ty, vw, vh);
      // зависимость от клеток — через картинку цветов
    } else {
      const cells = img.get();
      const ps = pulseStart.get();
      const pt = ps < 0 ? -1 : (clock.get() - ps) / 1000;
      pic = shaderPicture(res.effect, cells!, res.pal, res.dig, w, h, cam.s, cam.tx, cam.ty, vw, vh, dpr,
        sel.get(), mosaic.get(), hatch.get(), pulse.get(), pt);
    }
    if (phase.get() >= 0) probe.get().build.push(nowMs() - t0);
    return pic;
  });

  // ---------- кисть ----------

  /**
   * Отдаёт штрих в JS: во время долгого — частями раз в секунду, в конце — с `final`.
   * Конец уходит, даже если все клетки уже ушли частями: по нему экран обновляет процент.
   */
  const flush = (final: boolean) => {
    'worklet';
    const b = brush.get();
    if (onStroke && (b.pending.length || (final && b.cells.length))) {
      scheduleOnRN(onStroke, b.thread, b.pending.slice(), final);
    }
    b.pending = [];
    b.sentT = nowMs();
  };

  const addSegment = (x0: number, y0: number, x1: number, y1: number, any: boolean) => {
    'worklet';
    const t0 = nowMs();
    const b = brush.get();
    const k = s.get();
    const ox = tx.get();
    const oy = ty.get();
    const list: number[] = [];
    traverse((x0 - ox) / k, (y0 - oy) / k, (x1 - ox) / k, (y1 - oy) / k, w, h, list);
    const data = bytes.get();
    let changed = 0;
    for (let i = 0; i < list.length; i++) {
      if (stitchCell(data, list[i], b.thread, any)) {
        b.cells.push(list[i]);
        b.pending.push(list[i]);
        changed++;
      }
    }
    if (phase.get() >= 0) {
      probe.get().handler.push(nowMs() - t0);
      probe.get().stitches += changed;
    }
    if (changed) {
      refresh();
      if (onTick && phase.get() < 0 && t0 - lastTick.get() >= TICK_MS) {
        lastTick.set(t0);
        scheduleOnRN(onTick);
      }
    }
  };

  /**
   * Второй палец: в первые 100 мс штриха — это был масштаб, стежки снимаются; позже —
   * кисть заканчивается, стежки остаются. Штрих короче 100 мс ждёт в `hold`: палец мог
   * отпуститься раньше, чем жест масштаба узнал о втором пальце.
   */
  const twoFingers = () => {
    'worklet';
    const b = brush.get();
    if (!b.active && !b.hold) return;
    const young = nowMs() - b.startT < TWO_FINGER_MS;
    b.active = false;
    b.hold = false;
    if (b.far) return;
    if (young) {
      const data = bytes.get();
      for (let i = 0; i < b.cells.length; i++) data[b.cells[i] * 4 + 1] = 0;
      b.cells = [];
      b.pending = [];
      refresh();
    } else flush(true);
  };

  const oneFinger = Gesture.Pan()
    .maxPointers(1)
    .minDistance(0)
    .onTouchesDown((e) => {
      'worklet';
      if (e.numberOfTouches > 1) twoFingers();
    })
    .onBegin((e) => {
      'worklet';
      cancelAnimation(tx);
      cancelAnimation(ty);
      const b = brush.get();
      if (b.hold) {
        b.hold = false;
        flush(true);
      }
      const t = nowMs();
      const k = s.get();
      b.active = true;
      b.far = viewOnly || k < NUMBERS_DP;
      b.thread = sel.get();
      b.cells = [];
      b.pending = [];
      b.startX = b.lastX = e.x;
      b.startY = b.lastY = e.y;
      b.startT = b.sentT = t;
      b.moved = false;
      b.firstCell = hitCell(e.x, e.y, k, tx.get(), ty.get(), w, h);
      if (b.far) return;
      const cell = b.firstCell;
      if (cell >= 0 && fillOn.get() && onFill && t - b.lastTapT < DOUBLE_TAP_MS && cell === b.lastTapCell && bytes.get()[cell * 4] === b.thread) {
        b.lastTapT = -1e9;
        scheduleOnRN(onFill, cell);
      }
      addSegment(e.x, e.y, e.x, e.y, false);
    })
    .onUpdate((e) => {
      'worklet';
      const b = brush.get();
      if (!b.active) return;
      if (!b.moved && Math.hypot(e.x - b.startX, e.y - b.startY) > HOLD_DP) b.moved = true;
      if (b.far) {
        const k = s.get();
        tx.set(clampX(tx.get() + e.x - b.lastX, k, w, vw));
        ty.set(clampY(ty.get() + e.y - b.lastY, k, h, vh));
      } else {
        addSegment(b.lastX, b.lastY, e.x, e.y, false);
        if (nowMs() - b.sentT >= FLUSH_MS) flush(false);
      }
      b.lastX = e.x;
      b.lastY = e.y;
    })
    .onFinalize((e) => {
      'worklet';
      const b = brush.get();
      if (!b.active) return;
      b.active = false;
      if (b.far) {
        const k = s.get();
        if (!b.moved) {
          if (viewOnly) return;
          // касание далеко — приблизить это место до масштаба открытия
          const target = OPEN_DP;
          const cx = (e.x - tx.get()) / k;
          const cy = (e.y - ty.get()) / k;
          s.set(withTiming(target, { duration: 250 }));
          tx.set(withTiming(clampX(vw / 2 - cx * target, target, w, vw), { duration: 250 }));
          ty.set(withTiming(clampY(vh / 2 - cy * target, target, h, vh), { duration: 250 }));
        } else {
          tx.set(withDecay({ velocity: e.velocityX, clamp: [vw / 2 - w * k, vw / 2] }));
          ty.set(withDecay({ velocity: e.velocityY, clamp: [vh / 2 - h * k, vh / 2] }));
        }
        if (onCamera) scheduleOnRN(onCamera, { s: s.get(), tx: tx.get(), ty: ty.get() });
        return;
      }
      if (!b.moved && b.cells.length === 0 && b.firstCell >= 0 && onForeign) {
        const o = b.firstCell * 4;
        if (bytes.get()[o + 1] === 0 && bytes.get()[o] !== 255 && bytes.get()[o] !== b.thread) scheduleOnRN(onForeign, b.firstCell);
      }
      if (!b.moved) {
        b.lastTapT = nowMs();
        b.lastTapCell = b.firstCell;
      }
      if (nowMs() - b.startT < TWO_FINGER_MS) b.hold = true;
      else flush(true);
    });

  const hold = Gesture.LongPress()
    .minDuration(500)
    .maxDistance(HOLD_DP)
    .onStart((e) => {
      'worklet';
      if (viewOnly || !onPick) return;
      const cell = hitCell(e.x, e.y, s.get(), tx.get(), ty.get(), w, h);
      if (cell >= 0 && bytes.get()[cell * 4] !== 255) scheduleOnRN(onPick, cell);
    });

  // Жесты двух пальцев на Android «начинаются» и с одним пальцем: второй палец — только
  // когда указателей правда два, иначе они снимали бы каждый штрих кисти.
  const pinch = Gesture.Pinch()
    .onBegin((e) => {
      'worklet';
      if (e.numberOfPointers >= 2) twoFingers();
    })
    .onStart(() => {
      'worklet';
      twoFingers();
    })
    .onChange((e) => {
      'worklet';
      const k = s.get();
      const next = clampScale(k * e.scaleChange, w, h, vw, vh);
      const fx = e.focalX;
      const fy = e.focalY;
      tx.set(clampX(fx - ((fx - tx.get()) * next) / k, next, w, vw));
      ty.set(clampY(fy - ((fy - ty.get()) * next) / k, next, h, vh));
      s.set(next);
    })
    .onEnd(() => {
      'worklet';
      if (onCamera) scheduleOnRN(onCamera, { s: s.get(), tx: tx.get(), ty: ty.get() });
    });

  const twoPan = Gesture.Pan()
    .minPointers(2)
    .averageTouches(true)
    .onBegin((e) => {
      'worklet';
      if (e.numberOfPointers >= 2) twoFingers();
    })
    .onStart(() => {
      'worklet';
      twoFingers();
    })
    .onChange((e) => {
      'worklet';
      const k = s.get();
      tx.set(clampX(tx.get() + e.changeX, k, w, vw));
      ty.set(clampY(ty.get() + e.changeY, k, h, vh));
    });

  const gesture = Gesture.Simultaneous(oneFinger, hold, pinch, twoPan);

  // ---------- замер ----------

  const runScript = (t: number, dt: number) => {
    'worklet';
    if (!script) return;
    const ph = phase.get();
    const r = probe.get();
    if (phaseT.get() === 0) phaseT.set(t);
    const el = t - phaseT.get();
    const u = el / 1000;
    const fit = fitScale(w, h, vw, vh);
    if (ph === 0) {
      r.pan.push(dt);
      const k = OPEN_DP;
      const cx = w / 2 + (w / 2 - 4) * Math.sin(u * 0.9);
      const cy = h / 2 + (h / 2 - 4) * Math.sin(u * 0.63 + 1);
      s.set(k);
      tx.set(vw / 2 - cx * k);
      ty.set(vh / 2 - cy * k);
    } else if (ph === 1) {
      r.zoom.push(dt);
      const q = (1 - Math.cos(u * 1.3)) / 2;
      const k = fit * (MAX_DP / fit) ** q;
      s.set(k);
      tx.set(vw / 2 - (w / 2) * k);
      ty.set(vh / 2 - (h / 2) * k);
    } else if (ph === 2) {
      r.brush.push(dt);
      // палец идёт змейкой по строкам со скоростью brushRate клеток в секунду, камера — за ним
      const k = OPEN_DP;
      const pos = u * script.brushRate;
      const row = Math.floor(pos / w) % h;
      const along = pos % w;
      const cx = row % 2 ? w - along : along;
      const cy = row + 0.5;
      const sb = scripted.get();
      s.set(k);
      tx.set(vw / 2 - cx * k);
      ty.set(vh / 2 - cy * k);
      const b = brush.get();
      if (sb.row !== row) {
        b.active = true;
        b.thread = sel.get();
        b.cells = [];
        b.pending = [];
        sb.row = row;
        sb.x = cx;
      }
      // прошлая точка пальца — в экранных координатах нынешней камеры
      addSegment(tx.get() + sb.x * k, vh / 2, vw / 2, vh / 2, true);
      sb.x = cx;
    }
    if (el >= script.phaseMs) {
      if (ph >= 2) {
        phase.set(-1);
        brush.get().active = false;
        scripted.get().row = -1;
        if (onScriptDone) scheduleOnRN(onScriptDone, { ...r });
      } else {
        phase.set(ph + 1);
        phaseT.set(t);
      }
    }
  };

  // Пульсация «Где ещё?», живые числа кадров и замер. Часы двигаются только во время
  // пульсации: иначе кадр пересобирался бы каждый раз, а в покое канва не перерисовывается.
  useFrameCallback((info) => {
    'worklet';
    const ps = pulseStart.get();
    if (ps >= 0) {
      clock.set(info.timestamp);
      if (info.timestamp - ps > 1600) pulseStart.set(-1);
    } else if (clock.get() === 0) clock.set(info.timestamp);
    const dt = info.timeSincePreviousFrame ?? 16;
    const b = brush.get();
    if (b.hold && nowMs() - b.startT >= TWO_FINGER_MS) {
      b.hold = false;
      flush(true);
    }
    if (onLive) {
      const l = live.get();
      l.frames++;
      if (dt > l.worst) l.worst = dt;
      if (l.since === 0) l.since = info.timestamp;
      if (info.timestamp - l.since >= 1000) {
        scheduleOnRN(onLive, { fps: Math.round((l.frames * 1000) / (info.timestamp - l.since)), worst: Math.round(l.worst) });
        l.frames = 0;
        l.worst = 0;
        l.since = info.timestamp;
      }
    }
    if (script && phase.get() >= 0) runScript(info.timestamp, dt);
  }, true);

  useEffect(() => {
    if (!script) return;
    const initial = props.stitched;
    scheduleOnUI(() => {
      'worklet';
      // каждый замер — с одного и того же вышитого: иначе следующий прогон кисти идёт
      // по клеткам, вышитым прошлым, и почти не обновляет текстуру
      const data = bytes.get();
      for (let i = 0, o = 1; i < initial.length; i++, o += 4) if (data[o - 1] !== 255) data[o] = initial[i] ? 255 : 0;
      img.set(rgbaImage(data, w, h));
      rebuildColors();
      const r = probe.get();
      r.pan = [];
      r.zoom = [];
      r.brush = [];
      r.handler = [];
      r.texture = [];
      r.build = [];
      r.stitches = 0;
      phaseT.set(0);
      phase.set(0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script]);

  // ---------- API для экрана ----------

  useEffect(() => {
    apiRef.current = {
      stitch(cells) {
        const list = [...cells];
        scheduleOnUI(() => {
          'worklet';
          const data = bytes.get();
          let changed = false;
          for (let i = 0; i < list.length; i++) if (stitchCell(data, list[i], 0, true)) changed = true;
          if (changed) refresh();
        });
      },
      clear() {
        scheduleOnUI(() => {
          'worklet';
          const data = bytes.get();
          for (let i = 0; i < data.length; i += 4) data[i + 1] = 0;
          refresh();
        });
      },
      flyTo(g) {
        const k0 = s.get();
        const k = k0 >= NUMBERS_DP ? k0 : props.bigNumbers ? OPEN_BIG_DP : OPEN_DP;
        const x = clampX(vw / 2 - g.cx * k, k, w, vw);
        const y = clampY(vh / 2 - g.cy * k, k, h, vh);
        s.set(withTiming(k, { duration: 400 }));
        tx.set(withTiming(x, { duration: 400 }));
        ty.set(withTiming(y, { duration: 400 }));
        pulse.set([g.x0, g.y0, g.x1, g.y1]);
        pulseStart.set(clock.get() + 400);
        return { s: k, tx: x, ty: y };
      },
      camera() {
        return { s: s.get(), tx: tx.get(), ty: ty.get() };
      },
      fit(ms = 0) {
        const k = fitScale(w, h, vw, vh);
        const x = (vw - w * k) / 2;
        const y = (vh - h * k) / 2;
        if (ms > 0) {
          s.set(withTiming(k, { duration: ms }));
          tx.set(withTiming(x, { duration: ms }));
          ty.set(withTiming(y, { duration: ms }));
        } else {
          s.set(k);
          tx.set(x);
          ty.set(y);
        }
      },
    };
    return () => {
      apiRef.current = null;
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Canvas style={{ width: vw, height: vh }} opaque={props.opaque}>
        <Picture picture={picture} />
      </Canvas>
    </GestureDetector>
  );
}

/** Сводка замера: медиана, 95-й процентиль, доля кадров дольше 33 мс, худший. */
export function frameSummary(a: number[]): { n: number; p50: number; p95: number; slow: number; worst: number } {
  if (!a.length) return { n: 0, p50: 0, p95: 0, slow: 0, worst: 0 };
  const s = [...a].sort((x, y) => x - y);
  return {
    n: s.length,
    p50: median(s),
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
    slow: (s.filter((x) => x > 33).length * 100) / s.length,
    worst: s[s.length - 1],
  };
}

