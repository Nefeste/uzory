// Узор: сетка клеток с номерами нитей и палитра (docs/04-data-model.md, «Узор»).
// Чистый TypeScript: без React, платформы, времени и случайности (ADR 0002, 0010).

/** Клетка канвы: её не вышивают. */
export const CANVAS = 255;

/** Предел стороны узора в формате набора (u8); размеры игры — строже, в 08-game-design. */
export const MAX_SIDE = 255;
/** Предел нитей: палитра шейдера — текстура 64 × 1 (docs/02-architecture.md, «Канва»). */
export const MAX_THREADS = 64;

export interface Thread {
  /** 0xRRGGBB */
  rgb: number;
  /** «брусничная»; уникально в пределах узора */
  name: string;
}

export interface Pattern {
  /** «shishkin-utro-v-sosnovom-lesu@1» — картинка и версия узора */
  key: string;
  w: number;
  h: number;
  threads: Thread[];
  /** w × h, построчно: индекс нити или CANVAS */
  cells: Uint8Array;
}

export type SizeClass = 'S' | 'M' | 'L';

/** Ошибка узора словами — или null, если узор цел. Проверяет и сборка, и загрузка набора. */
export function patternError(p: Pattern): string | null {
  if (!/^[a-z0-9][a-z0-9-]*@[1-9][0-9]*$/.test(p.key)) return `ключ «${p.key}» не вида id@версия`;
  if (!Number.isInteger(p.w) || !Number.isInteger(p.h) || p.w < 1 || p.h < 1 || p.w > MAX_SIDE || p.h > MAX_SIDE) return `размер ${p.w}×${p.h} вне 1…${MAX_SIDE}`;
  if (p.cells.length !== p.w * p.h) return `клеток ${p.cells.length}, а должно быть ${p.w * p.h}`;
  const n = p.threads.length;
  if (n < 1 || n > MAX_THREADS) return `нитей ${n} вне 1…${MAX_THREADS}`;
  const used = new Uint8Array(n);
  for (let i = 0; i < p.cells.length; i++) {
    const t = p.cells[i];
    if (t === CANVAS) continue;
    if (t >= n) return `клетка ${i}: нить ${t}, а нитей ${n}`;
    used[t] = 1;
  }
  for (let t = 0; t < n; t++) if (!used[t]) return `нить ${t + 1} не встречается ни в одной клетке`;
  const names = new Set<string>();
  for (const th of p.threads) {
    if (!Number.isInteger(th.rgb) || th.rgb < 0 || th.rgb > 0xffffff) return `цвет нити «${th.name}» не 0xRRGGBB`;
    if (names.has(th.name)) return `название нити «${th.name}» повторяется`;
    names.add(th.name);
  }
  return null;
}

/** Сколько клеток у каждой нити. */
export function threadCounts(p: Pattern): Uint32Array {
  const c = new Uint32Array(p.threads.length);
  for (let i = 0; i < p.cells.length; i++) {
    const t = p.cells[i];
    if (t !== CANVAS) c[t]++;
  }
  return c;
}

/** Вышиваемые клетки — все, кроме канвы. */
export function stitchable(p: Pattern): number {
  let n = 0;
  for (let i = 0; i < p.cells.length; i++) if (p.cells[i] !== CANVAS) n++;
  return n;
}

/** Размер по числу вышиваемых клеток (docs/08-game-design.md, «Размеры узоров»). */
export function sizeClass(p: Pattern): SizeClass {
  const n = stitchable(p);
  return n <= 1600 ? 'S' : n <= 4900 ? 'M' : 'L';
}

/**
 * Оценка времени для карточки, в минутах: вышиваемые клетки ÷ 4 в секунду + 15 секунд
 * на нить, округлено до пяти минут, но не меньше пяти (docs/08-game-design.md).
 */
export function estimateMinutes(p: Pattern): number {
  const seconds = stitchable(p) / 4 + 15 * p.threads.length;
  return Math.max(5, Math.round(seconds / 300) * 5);
}

/** Цвет нити строкой `#rrggbb`. */
export const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

/** `#rrggbb` → 0xRRGGBB; null, если строка не цвет. */
export function parseHex(s: string): number | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(s);
  return m ? parseInt(m[1], 16) : null;
}
