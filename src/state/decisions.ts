// Текст решений «Листа узоров» (docs/09-content.md, §8): владелец вставляет его в сообщение
// ассистенту, а тот ставит `approved` в карточки и правит то, о чём комментарий. Подписи берутся
// из словаря (src/i18n), поэтому функции чистые и их проверяет тест (tools/test/decisions.test.ts).

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
  /** группа картинок с комментарием, но без отметки */
  noPick: string;
  /** картинка в тексте: «Название (id@v)», а комментарий — после неё */
  item: (title: string, id: string, note: string) => string;
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
): [string, string[]][] {
  const item = (pic: { id: string; v: number; title: string }) => labels.item(pic.title, pickKey(pic), notes[pickKey(pic)] ?? '');
  return [
    ...PICKS.map((v): [string, string[]] => [labels.picks[v], rows.filter((pic) => picks[pickKey(pic)] === v).map(item)]),
    [labels.noPick, rows.filter((pic) => !picks[pickKey(pic)] && notes[pickKey(pic)]).map(item)],
  ];
}
