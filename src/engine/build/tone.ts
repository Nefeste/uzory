// Тон для выцветшего снимка (отбор 0.15.9, 24.10.2026: «бледно» — у «Ниловой пустыни»,
// «Кирилло-Белозерского монастыря», «Церкви Николая Чудотворца» середина слишком светлая и цвета
// слабые уже в исходнике). Светлота растягивается до полной, середина темнеет до обычной, слабые
// цвета — насыщеннее. Баланса белого нет: самые светлые клетки снимка — часто небо или песок, а не
// белое, и «баланс» по ним красил всё в сиреневый. Тон заметно меняет и обычные снимки «России в
// цвете» — почти все они светлые и неяркие, — поэтому он ставится в карточку, а не всем подряд.
import { labToLinear, linearToLabInto } from '../color';
import type { Grid } from './grid';

/** Светлота от 0,5-й до 99,5-й доли — к [LO, HI]; край сдвигается, только если снимок уже. */
export const TONE_LO = 0.15;
export const TONE_HI = 0.96;
/** Середина: степень, чтобы медиана светлоты стала TONE_MID, — от 1 до TONE_GAMMA_MAX. */
export const TONE_MID = 0.7;
export const TONE_GAMMA_MAX = 1.8;
/** Насыщенность: чтобы медиана хромы стала не меньше TONE_CHROMA, — не больше ×TONE_CHROMA_MAX. */
export const TONE_CHROMA = 0.05;
export const TONE_CHROMA_MAX = 1.4;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Сетка с тоном силы `k` (0…1: доля пути от исходника к поправленному). */
export function toneGrid(g: Grid, k: number): Grid {
  const n = g.w * g.h;
  const lab = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) linearToLabInto(g.rgb[i * 3], g.rgb[i * 3 + 1], g.rgb[i * 3 + 2], lab, i * 3);
  const Ls = Float64Array.from({ length: n }, (_, i) => lab[i * 3]).sort();
  const Cs = Float64Array.from({ length: n }, (_, i) => Math.hypot(lab[i * 3 + 1], lab[i * 3 + 2])).sort();
  const p1 = Ls[Math.floor(0.005 * n)], p99 = Ls[Math.min(n - 1, Math.floor(0.995 * n))];
  const lo = Math.min(p1, TONE_LO), hi = Math.max(p99, TONE_HI);
  const stretch = (L: number) => (p99 > p1 ? lo + ((L - p1) * (hi - lo)) / (p99 - p1) : L);
  const med = Math.min(0.999, Math.max(0.001, stretch(Ls[Math.floor(0.5 * n)])));
  const gamma = Math.min(TONE_GAMMA_MAX, Math.max(1, Math.log(TONE_MID) / Math.log(med)));
  const cm = Cs[Math.floor(0.5 * n)];
  const chroma = Math.min(TONE_CHROMA_MAX, Math.max(1, cm > 0 ? TONE_CHROMA / cm : 1));
  const rgb = new Float64Array(g.rgb.length);
  for (let i = 0; i < n; i++) {
    const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
    const L2 = clamp01(stretch(L)) ** gamma;
    const c = 1 + (chroma - 1) * k;
    const out = labToLinear([L + (L2 - L) * k, a * c, b * c]);
    rgb[i * 3] = clamp01(out[0]); rgb[i * 3 + 1] = clamp01(out[1]); rgb[i * 3 + 2] = clamp01(out[2]);
  }
  return g.paper ? { ...g, rgb } : { w: g.w, h: g.h, rgb };
}
