// Текст решений «Листа узоров» (docs/09-content.md, §8): владелец вставляет его в сообщение
// ассистенту, а тот ставит `approved` в карточки и правит то, о чём комментарий. Подписи берутся
// из словаря (src/i18n), поэтому функции чистые и их проверяет тест (tools/test/decisions.test.ts).
import { SIZES } from '../engine/build/checks';

export type Pick = 'yes' | 'no' | 'later';

export const PICKS: readonly Pick[] = ['yes', 'no', 'later'];

/** Комментарий короткий: «что поправить», а не письмо. */
export const NOTE_MAX = 200;

/** Комментарий в одну строку, без пробелов по краям и не длиннее NOTE_MAX; пустая строка — комментария нет. */
export function cleanNote(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX).trim();
}

export interface DecisionLabels {
  picks: Record<Pick, string>;
  /** группа картинок с комментарием или настройками, но без отметки */
  noPick: string;
  /** картинка в тексте: «Название (id@v)», за ней настройки в фигурных скобках и комментарий */
  item: (title: string, id: string, note: string, tune?: string) => string;
  /** слова настроек в тексте: «клеток 450, нитей 40, упрощение: немного» */
  tuneWords: { size: string; threads: string; simplify: string; levels: readonly [string, string, string] };
}

/**
 * Настройки узора, при которых владелец согласен (0.24.1; владелец 01.11.2026: «выбрать и сказать, что вот
 * столько клеток если сделать, то рисунок принимается»): клеток по длинной стороне, нитей, упрощение. С «да» —
 * ассистент пересобирает картинку с ними и ставит «да» новой версии; без «да» — просьба пересобрать так.
 */
export interface Tune {
  size?: number;
  threads?: number;
  /** 0 — нет, 1 — немного, 2 — сильно (src/engine/build/simplify.ts) */
  simplify?: 0 | 1 | 2;
}

/** Клеток по длинной стороне — от и до: меньше узор теряет картинку, больше — не влезает в набор. */
export const TUNE_SIDE: readonly [number, number] = [20, 600];
/** Нитей — от и до: больше, чем у «Огромной», карточка не пропустит (tools/content/cards.ts). */
export const TUNE_THREADS: readonly [number, number] = [2, SIZES.XL.threads[1]];

/** Настройки в пределах, целыми; пустые — undefined. */
export function cleanTune(t: Tune | undefined): Tune | undefined {
  if (!t) return undefined;
  const ok = (x: unknown, [lo, hi]: readonly [number, number]) => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;
  const out: Tune = {
    ...(ok(t.size, TUNE_SIDE) ? { size: t.size } : {}),
    ...(ok(t.threads, TUNE_THREADS) ? { threads: t.threads } : {}),
    ...(t.simplify === 0 || t.simplify === 1 || t.simplify === 2 ? { simplify: t.simplify } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** Настройки строкой: «клеток 450, нитей 40, упрощение: немного». */
export function tuneText(t: Tune, w: DecisionLabels['tuneWords']): string {
  return [
    t.size !== undefined ? `${w.size} ${t.size}` : '',
    t.threads !== undefined ? `${w.threads} ${t.threads}` : '',
    t.simplify !== undefined ? `${w.simplify}: ${w.levels[t.simplify]}` : '',
  ].filter(Boolean).join(', ');
}

/** Отметка и комментарий — у версии картинки: новая версия узора приходит на отбор без прежней отметки. */
export const pickKey = (pic: { id: string; v: number }) => `${pic.id}@${pic.v}`;

/**
 * Группы по порядку листа: «Да», «Нет», «Позже» и картинки, у которых есть только комментарий. Отметки и
 * комментарии — по версии картинки (pickKey), и версия же — в тексте: «Название (id@v)».
 */
export function decisionGroups(
  rows: readonly { id: string; v: number; title: string }[],
  picks: Readonly<Record<string, Pick>>,
  notes: Readonly<Record<string, string>>,
  labels: DecisionLabels,
  tunes: Readonly<Record<string, Tune>> = {},
): [string, string[]][] {
  const tuneOf = (pic: { id: string; v: number }) => {
    const t = cleanTune(tunes[pickKey(pic)]);
    return t ? tuneText(t, labels.tuneWords) : '';
  };
  const item = (pic: { id: string; v: number; title: string }) => labels.item(pic.title, pickKey(pic), notes[pickKey(pic)] ?? '', tuneOf(pic));
  return [
    ...PICKS.map((v): [string, string[]] => [labels.picks[v], rows.filter((pic) => picks[pickKey(pic)] === v).map(item)]),
    [labels.noPick, rows.filter((pic) => !picks[pickKey(pic)] && (notes[pickKey(pic)] || tuneOf(pic))).map(item)],
  ];
}
