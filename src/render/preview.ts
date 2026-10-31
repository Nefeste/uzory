// Превью узора картинкой PNG (docs/specs/2026-09-library.md, «Библиотека»): не канва на
// каждую карточку, а изображение. Малый узор увеличивается без сглаживания — клетки остаются
// клетками; большой уменьшается усреднением клеток, как видит его глаз издалека.
import { ImageFormat } from '@shopify/react-native-skia';
import { rgbaImage } from '../canvas/textures';
import { mix, muted } from '../engine/color';
import { CANVAS, type Pattern } from '../engine/pattern';

const CLOTH = 0xf3f0e6;

/** Готовые превью без вышитых клеток — в памяти: библиотека листается туда и обратно. */
const cache = new Map<string, string | null>();
const CACHE_MAX = 600;

/** Забыть готовые превью: «Замер прокрутки» листает библиотеку с ещё не нарисованными. */
export function clearPreviews(): void {
  cache.clear();
}

/** Сетка по невышитым клеткам превью — с клетки в столько точек: мельче она рябит. */
const GRID_FROM = 4;

/**
 * «done» — готовая работа; «muted» — ещё не начатая: приглушённым цветом, с лёгкой сеткой на крупных
 * клетках (решение владельца 31.10.2026, issue 130, вариант Б; docs/08-game-design.md, «Превью»); со
 * `stitched` — начатая: вышитое полным цветом, остальное — приглушённым.
 */
export function previewUri(p: Pattern, mode: 'done' | 'muted', side = 360, stitched?: Uint8Array): string | null {
  const key = stitched ? null : `${p.key}|${mode}|${side}`;
  if (key && cache.has(key)) return cache.get(key)!;
  const uri = render(p, mode, side, stitched);
  if (key) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, uri);
  }
  return uri;
}

function render(p: Pattern, mode: 'done' | 'muted', side: number, stitched?: Uint8Array): string | null {
  const colors = p.threads.map((t) => (mode === 'done' ? t.rgb : muted(t.rgb)));
  const color = (i: number) => {
    const t = p.cells[i];
    return t === CANVAS ? CLOTH : stitched?.[i] ? p.threads[t].rgb : colors[t];
  };
  // ещё не вышитая клетка — с линией сетки по правому и нижнему краю
  const open = (i: number) => mode !== 'done' && p.cells[i] !== CANVAS && !stitched?.[i];
  const big = Math.max(p.w, p.h);
  let W: number;
  let H: number;
  let out: Uint8Array;
  if (big <= side) {
    const k = Math.max(1, Math.floor(side / big));
    W = p.w * k;
    H = p.h * k;
    out = new Uint8Array(W * H * 4);
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const i = y * p.w + x;
        const c = color(i);
        const line = k >= GRID_FROM && open(i) ? mix(c, 0x3b3e3c, 0.12) : c;
        for (let dy = 0; dy < k; dy++) {
          let o = ((y * k + dy) * W + x * k) * 4;
          for (let dx = 0; dx < k; dx++) {
            const v = dx === k - 1 || dy === k - 1 ? line : c;
            out[o] = (v >> 16) & 255;
            out[o + 1] = (v >> 8) & 255;
            out[o + 2] = v & 255;
            out[o + 3] = 255;
            o += 4;
          }
        }
      }
    }
  } else {
    // точка превью — среднее клеток, которые в неё попадают
    const f = side / big;
    W = Math.max(1, Math.round(p.w * f));
    H = Math.max(1, Math.round(p.h * f));
    out = new Uint8Array(W * H * 4);
    for (let oy = 0; oy < H; oy++) {
      const y0 = Math.floor((oy * p.h) / H);
      const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * p.h) / H));
      for (let ox = 0; ox < W; ox++) {
        const x0 = Math.floor((ox * p.w) / W);
        const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * p.w) / W));
        let r = 0;
        let g = 0;
        let b = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const c = color(y * p.w + x);
            r += (c >> 16) & 255;
            g += (c >> 8) & 255;
            b += c & 255;
          }
        }
        const n = (y1 - y0) * (x1 - x0);
        const o = (oy * W + ox) * 4;
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
        out[o + 3] = 255;
      }
    }
  }
  const img = rgbaImage(out, W, H);
  if (!img) return null;
  return `data:image/png;base64,${img.encodeToBase64(ImageFormat.PNG, 100)}`;
}
