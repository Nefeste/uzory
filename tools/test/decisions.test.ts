// Текст решений «Листа узоров» (src/state/decisions.ts): комментарий владельца — что поправить —
// стоит после своей картинки; картинки с одним комментарием, без отметки, — своей группой; пустой
// и пробельный комментарий — не комментарий. Без комментариев текст тот же, что до 0.15.5.
import { describe, expect, test } from 'bun:test';
import { ru } from '../../src/i18n/ru';
import { cleanNote, decisionGroups, NOTE_MAX } from '../../src/state/decisions';

const rows = [
  { id: 'first-picture', title: 'Первая картинка' },
  { id: 'rozetka', title: 'Розетка' },
  { id: 'zvezda-alatyr', title: 'Восьмиконечная звезда' },
  { id: 'kids-kit', title: 'Кит' },
];
const text = (picks: Parameters<typeof decisionGroups>[1], notes: Parameters<typeof decisionGroups>[2]) =>
  ru.sheet.picksText('0.15.5', '2026-10-16', decisionGroups(rows, picks, notes, ru.sheet));

describe('решения листа', () => {
  test('комментарий — после картинки, в кавычках; картинки только с комментарием — своей группой', () => {
    expect(text({ 'first-picture': 'yes', rozetka: 'no', 'kids-kit': 'no' }, { rozetka: 'мелко, не видно лепестков', 'zvezda-alatyr': 'темнее фон' })).toBe([
      'Узоры 0.15.5 — отбор картинок, 2026-10-16',
      'Да (1): Первая картинка (first-picture)',
      'Нет (2): Розетка (rozetka) — «мелко, не видно лепестков», Кит (kids-kit)',
      'Без отметки, с комментарием (1): Восьмиконечная звезда (zvezda-alatyr) — «темнее фон»',
    ].join('\n'));
  });

  test('без комментариев — как до 0.15.5: группы по порядку листа, пустые не пишутся', () => {
    expect(text({ 'kids-kit': 'later', 'first-picture': 'yes', rozetka: 'yes' }, {})).toBe([
      'Узоры 0.15.5 — отбор картинок, 2026-10-16',
      'Да (2): Первая картинка (first-picture), Розетка (rozetka)',
      'Позже (1): Кит (kids-kit)',
    ].join('\n'));
  });

  test('комментарий — одной строкой, без пробелов по краям и не длиннее предела', () => {
    expect(cleanNote('  мелко\n  и   темно  ')).toBe('мелко и темно');
    expect(cleanNote(' \n\t ')).toBe('');
    expect(cleanNote('а'.repeat(NOTE_MAX + 50))).toHaveLength(NOTE_MAX);
    expect(cleanNote(`${'а'.repeat(NOTE_MAX - 1)} б`)).toBe('а'.repeat(NOTE_MAX - 1));
  });
});
