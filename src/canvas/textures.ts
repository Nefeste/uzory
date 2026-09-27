// Текстуры данных для шейдера канвы (docs/02-architecture.md, «Канва»): клетки, палитра,
// атлас цифр. Все — растровые изображения Skia: их можно передавать на UI-поток.
import { AlphaType, ColorType, Skia, type SkFont, type SkImage } from '@shopify/react-native-skia';
import { CANVAS, type Pattern } from '../engine/pattern';

/** Ячейка атласа цифр, точки. Цифра — белая, прозрачный фон. */
export const GLYPH_W = 32;
export const GLYPH_H = 48;

/** Клетки: R — нить, G — вышита (255), B — «возраст» для анимаций, A — 255. */
export function cellBytes(p: Pattern, stitched: Uint8Array): Uint8Array {
  const out = new Uint8Array(p.w * p.h * 4);
  for (let i = 0; i < p.cells.length; i++) {
    out[i * 4] = p.cells[i];
    out[i * 4 + 1] = stitched[i] && p.cells[i] !== CANVAS ? 255 : 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function rgbaImage(bytes: Uint8Array, w: number, h: number): SkImage | null {
  'worklet';
  return Skia.Image.MakeImage({ width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }, Skia.Data.fromBytes(bytes), w * 4);
}

export function paletteImage(p: Pattern): SkImage | null {
  const out = new Uint8Array(64 * 4);
  p.threads.forEach((t, i) => out.set([(t.rgb >> 16) & 255, (t.rgb >> 8) & 255, t.rgb & 255, 255], i * 4));
  return rgbaImage(out, 64, 1);
}

/**
 * Атлас цифр шрифтом студии: десять цифр по GLYPH_W × GLYPH_H, каждая по центру своей
 * ячейки. Высота цифр меряется по нарисованному (`measureText` в вебе нет): первый проход —
 * проба, второй — по центру. Растровая поверхность, а не видеокарта: изображение живёт
 * и на UI-потоке.
 */
export function digitAtlas(font: SkFont): SkImage | null {
  const W = GLYPH_W * 10;
  const draw = (baseline: number) => {
    const surface = Skia.Surface.Make(W, GLYPH_H);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    const paint = Skia.Paint();
    paint.setColor(Skia.Color('white'));
    paint.setAntiAlias(true);
    for (let d = 0; d < 10; d++) {
      const t = String(d);
      canvas.drawText(t, d * GLYPH_W + (GLYPH_W - font.getTextWidth(t)) / 2, baseline, paint, font);
    }
    surface.flush();
    return surface.makeImageSnapshot();
  };
  const guess = GLYPH_H * 0.8;
  const probe = draw(guess);
  if (!probe) return null;
  const px = probe.readPixels(0, 0, { width: W, height: GLYPH_H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  let top = GLYPH_H;
  let bottom = -1;
  if (px) {
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = 0; x < W; x++) {
        if (px[(y * W + x) * 4 + 3] > 40) {
          if (y < top) top = y;
          bottom = y;
          break;
        }
      }
    }
  }
  const shift = bottom >= top ? GLYPH_H / 2 - (top + bottom + 1) / 2 : 0;
  return draw(guess + shift)?.makeNonTextureImage() ?? null;
}

/** Размер шрифта цифр для атласа: высота цифры — 0,75 ячейки. */
export const DIGIT_FONT_SIZE = 50;
