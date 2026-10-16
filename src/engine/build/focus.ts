// Важные части снимка (владелец 15.10.2026: «у более важных частей крайне важна детализация…
// Важные части — это например лица или другие элементы узнаваемости объектов»). Лицо на снимке —
// сотая доля кадра: палитра всего снимка отдаёт его нитям травы, неба и рубахи, а чистка «конфетти»
// стирает глаза, ноздри и рот — пятна в клетку-две. Автор карточки обводит лицо рамкой
// (`pattern.focus`, доли снимка, как `crop`), и сборка палитры (./palette.ts) даёт рамке свою
// маленькую палитру — кожа, тени, губы, глаза, — а мелкое пятно в ней перекрашивает только в почти
// тот же цвет: тёмный глаз на коже остаётся, рябь соседних оттенков кожи уходит.
import type { Rect } from './eyes';

/** Нитей на важные части — не больше стольких и не больше пятой части нитей узора. */
export const FOCUS_THREADS = 6;
/**
 * В рамке нити всего снимка считаются во столько раз дальше нитей лица: светлая щека по числам
 * близка к бело-сиреневой рубахе, а на глаз это пятно на лице.
 */
export const FOCUS_FAR = 2;
/** Нить важных частей: столько её клеток в рамках, не меньше. */
export const FOCUS_SHARE = 0.3;
/**
 * Редкая нить — реже 0,2 % вышиваемых клеток (docs/09-content.md, §6): сборка её сливает, проверка
 * не пропускает. Нити важных частей — вчетверо реже: глаза, губы и тень у носа на лице — сотни
 * клеток на весь снимок, а без них лицо — пятно.
 */
export const RARE_SHARE = 0.002;
export const FOCUS_RARE_SHARE = 0.0005;

/** Меньше стольких клеток у нити быть не может: у нити важных частей — `focus`. */
export const fewestCells = (stitched: number, focus = false) => Math.max(8, Math.ceil(stitched * (focus ? FOCUS_RARE_SHARE : RARE_SHARE)));

/** Доля клеток каждой из `k` нитей, что лежат в важных частях (`cells` — номера нитей, −1 и больше `k` — не нить). */
export function focusShare(cells: ArrayLike<number>, focus: Uint8Array, k: number): number[] {
  const inside = new Array<number>(k).fill(0);
  const all = new Array<number>(k).fill(0);
  for (let i = 0; i < cells.length; i++) {
    const t = cells[i];
    if (t < 0 || t >= k) continue;
    all[t]++;
    if (focus[i]) inside[t]++;
  }
  return inside.map((x, j) => x / Math.max(1, all[j]));
}

/** Нитей на важные части у узора из `threads` нитей. */
export const focusThreads = (threads: number) => Math.min(FOCUS_THREADS, Math.floor(threads / 5));

/**
 * Клетки узора `w` × `h` из кадра `crop`, чей центр — в одной из рамок `rects` (доли снимка, как у
 * глаз, ./eyes.ts): 1 — важная часть. Ни одной такой клетки — `undefined`, узор как без рамок.
 */
export function focusMask(crop: Rect, w: number, h: number, rects: readonly Rect[]): Uint8Array | undefined {
  const mask = new Uint8Array(w * h);
  const cx = (fx: number) => ((fx - crop[0]) / (crop[2] - crop[0])) * w;
  const cy = (fy: number) => ((fy - crop[1]) / (crop[3] - crop[1])) * h;
  let any = false;
  for (const [a0, b0, a1, b1] of rects) {
    for (let y = Math.max(0, Math.ceil(cy(b0) - 0.5)); y < h && y + 0.5 <= cy(b1); y++) {
      for (let x = Math.max(0, Math.ceil(cx(a0) - 0.5)); x < w && x + 0.5 <= cx(a1); x++) {
        mask[y * w + x] = 1;
        any = true;
      }
    }
  }
  return any ? mask : undefined;
}
