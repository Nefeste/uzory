// Превью узора картинкой PNG (docs/specs/2026-09-library.md, «Библиотека»): не канва на
// каждую карточку, а изображение, увеличенное без сглаживания — клетки остаются клетками.
import { ImageFormat } from '@shopify/react-native-skia';
import { rgbaImage } from '../canvas/textures';
import { mix } from '../engine/color';
import { CANVAS, type Pattern } from '../engine/pattern';

const CLOTH = 0xf3f0e6;

/**
 * «done» — готовая работа; «scheme» — ещё не начатая: бледные тона без цвета
 * (docs/08-game-design.md, «Превью»); со `stitched` — начатая: цветом там, где вышито.
 */
export function previewUri(p: Pattern, mode: 'done' | 'scheme', side = 360, stitched?: Uint8Array): string | null {
  const k = Math.max(1, Math.floor(side / Math.max(p.w, p.h)));
  const W = p.w * k;
  const H = p.h * k;
  const out = new Uint8Array(W * H * 4);
  const colors = p.threads.map((t) => {
    if (mode === 'done') return t.rgb;
    const r = (t.rgb >> 16) & 255;
    const g = (t.rgb >> 8) & 255;
    const b = t.rgb & 255;
    const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    return mix(0xf6f6f2, (l << 16) | (l << 8) | l, 0.35);
  });
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x;
      const t = p.cells[i];
      const c = t === CANVAS ? CLOTH : stitched?.[i] ? p.threads[t].rgb : colors[t];
      for (let dy = 0; dy < k; dy++) {
        let o = ((y * k + dy) * W + x * k) * 4;
        for (let dx = 0; dx < k; dx++) {
          out[o] = (c >> 16) & 255;
          out[o + 1] = (c >> 8) & 255;
          out[o + 2] = c & 255;
          out[o + 3] = 255;
          o += 4;
        }
      }
    }
  }
  const img = rgbaImage(out, W, H);
  if (!img) return null;
  return `data:image/png;base64,${img.encodeToBase64(ImageFormat.PNG, 100)}`;
}
