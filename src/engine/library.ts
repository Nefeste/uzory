// Картинка библиотеки — всё, что показывается вокруг узора (docs/04-data-model.md, «Картинка»).
import type { SizeClass } from './pattern';

export type CollectionId = 'ornaments' | 'painting' | 'tales' | 'russia'
  | 'flowers' | 'nature' | 'cities' | 'kids';

/** Порядок коллекций в библиотеке — как в docs/09-content.md, §1. */
export const COLLECTIONS: readonly CollectionId[] = [
  'ornaments', 'painting', 'tales', 'russia', 'flowers', 'nature', 'cities', 'kids',
];

/** Размеры узоров (docs/08-game-design.md, «Размеры узоров»). */
export const SIZE_CLASSES: readonly SizeClass[] = ['S', 'M', 'L', 'XL'];

/** Сколько первых картинок каждой коллекции бесплатны (docs/08-game-design.md). */
export const FREE_FIRST = 5;

export interface Picture {
  /** «shishkin-utro-v-sosnovom-lesu» — вечный, латиницей */
  id: string;
  /** текущая версия узора; ключ узора — `${id}@${v}` */
  v: number;
  title: string;
  collection: CollectionId;
  /** место в коллекции; первые пять (order < 5) бесплатны */
  order: number;
  size: SizeClass;
  /** бесплатна всегда, независимо от order («Детям») */
  free?: true;
  author?: { name: string; life?: string };
  made?: string;
  place?: string;
  /** рассказ о картине, 2–4 фразы */
  about?: string;
  source: { url: string; basis: string };
  /** дата выхода в библиотеку, «2026-10-12» */
  added: string;
  /** убрана из библиотеки и календаря; узор грузится для работ */
  hidden?: true;
  /**
   * Только для сборок-проверок 0.0.x: нет «да» владельца или права не решены
   * (docs/09-content.md, §2). В наборы для игроков такие картинки не попадают.
   */
  trial?: true;
}

export interface CalendarDay {
  date: string;
  picture: string;
}

export const patternKey = (p: Pick<Picture, 'id' | 'v'>) => `${p.id}@${p.v}`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** Ошибка карточки словами или null: проверяют сборка и чтение набора. */
export function pictureError(p: Picture): string | null {
  if (typeof p !== 'object' || p === null) return 'карточка — не объект';
  if (typeof p.id !== 'string' || !ID.test(p.id)) return `id «${String(p.id)}» — не латиница через дефис`;
  const at = `картинка ${p.id}`;
  if (!Number.isInteger(p.v) || p.v < 1) return `${at}: версия ${String(p.v)}`;
  if (typeof p.title !== 'string' || !p.title.trim()) return `${at}: нет названия`;
  if (!COLLECTIONS.includes(p.collection)) return `${at}: коллекция «${String(p.collection)}»`;
  if (!Number.isInteger(p.order) || p.order < 0) return `${at}: order ${String(p.order)}`;
  if (!SIZE_CLASSES.includes(p.size)) return `${at}: размер «${String(p.size)}»`;
  if (p.free !== undefined && p.free !== true) return `${at}: free только true`;
  if (p.hidden !== undefined && p.hidden !== true) return `${at}: hidden только true`;
  if (p.trial !== undefined && p.trial !== true) return `${at}: trial только true`;
  if (typeof p.source !== 'object' || p.source === null || typeof p.source.url !== 'string' || !p.source.basis) {
    return `${at}: нет источника и основания`;
  }
  if (typeof p.added !== 'string' || !DATE.test(p.added)) return `${at}: дата выхода «${String(p.added)}»`;
  for (const k of ['made', 'place', 'about'] as const) {
    if (p[k] !== undefined && typeof p[k] !== 'string') return `${at}: ${k} — не строка`;
  }
  if (p.author !== undefined && (typeof p.author !== 'object' || typeof p.author.name !== 'string')) {
    return `${at}: автор без имени`;
  }
  return null;
}
