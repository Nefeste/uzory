// «Тайна» (решение владельца 31.10.2026 по issue 117, вариант А; docs/08-game-design.md, «Тайна»): игрок
// выбирает только размер, игра — картинку, которую он ещё не начинал, из доступных ему: бесплатных,
// прошлых картинок дня и «Узоров+», если подписка действует. Сегодняшняя картинка дня — не «тайна»: она и
// так на главной. В календарь «тайна» не попадает: это не картинка дня, а случайная картинка библиотеки.
import type { Access } from './access';
import type { Picture } from './library';
import type { SizeClass } from './pattern';

/** Размеры на выбор: малая, средняя, большая (большая — и огромные картины). */
export type MysterySize = 'S' | 'M' | 'L';

const FITS: Record<MysterySize, readonly SizeClass[]> = { S: ['S'], M: ['M'], L: ['L', 'XL'] };

export interface MysteryContext<P extends Picture = Picture> {
  /** доступ к картинке (src/engine/access.ts) */
  access: (p: P) => Access;
  /** есть ли у игрока работа по картинке — начатая или готовая */
  hasWork: (p: P) => boolean;
  /** сегодняшняя картинка дня */
  dailyId?: string;
}

/** Картинки, из которых выбирается «тайна» этого размера. */
export function mysteryPool<P extends Picture>(pics: readonly P[], size: MysterySize, ctx: MysteryContext<P>): P[] {
  return pics.filter((p) => {
    if (p.hidden || p.id === ctx.dailyId || !FITS[size].includes(p.size) || ctx.hasWork(p)) return false;
    const a = ctx.access(p);
    return a === 'free' || a === 'daily' || a === 'plus';
  });
}

/** Случайная картинка из пула; пул пуст — null (всё этого размера уже начато или заперто). */
export function pickMystery<P>(pool: readonly P[], random: () => number): P | null {
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] : null;
}
