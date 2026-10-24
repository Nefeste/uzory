// Текст решений «Листа узоров» (src/state/decisions.ts): комментарий владельца — что поправить —
// стоит после своей картинки; картинки с одним комментарием, без отметки, — своей группой; пустой
// и пробельный комментарий — не комментарий. Без комментариев текст тот же, что до 0.15.5.
// Обратно его разбирает tools/content/decisions.ts: что прислал владелец — то и в карточках.
import { describe, expect, test } from 'bun:test';
import { ru } from '../../src/i18n/ru';
import { cleanNote, decisionGroups, NOTE_MAX } from '../../src/state/decisions';
import { approve, hide, parseDecisions } from '../content/decisions';

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

describe('текст решений → карточки (tools/content/decisions.ts)', () => {
  test('разбор — те же отметки и комментарии, что в листе; запятые в названии и в комментарии не мешают', () => {
    const many = [...rows, { id: 'khram-very-nadezhdy-lyubvi', title: 'Храм Веры, Надежды, Любови и матери их Софии' }];
    const picks = { 'first-picture': 'yes', 'khram-very-nadezhdy-lyubvi': 'yes', rozetka: 'no', 'kids-kit': 'later' } as const;
    const notes = { rozetka: 'мелко, не видно (совсем) лепестков', 'zvezda-alatyr': 'темнее фон', 'kids-kit': 'кит бледный' };
    const d = parseDecisions(ru.sheet.picksText('0.15.6', '2026-10-17', decisionGroups(many, picks, notes, ru.sheet)));
    expect(d.version).toBe('0.15.6');
    expect(d.date).toBe('2026-10-17');
    expect(d.items).toEqual([
      { id: 'first-picture', title: 'Первая картинка', pick: 'yes', note: '' },
      { id: 'khram-very-nadezhdy-lyubvi', title: 'Храм Веры, Надежды, Любови и матери их Софии', pick: 'yes', note: '' },
      { id: 'rozetka', title: 'Розетка', pick: 'no', note: 'мелко, не видно (совсем) лепестков' },
      { id: 'kids-kit', title: 'Кит', pick: 'later', note: 'кит бледный' },
      { id: 'zvezda-alatyr', title: 'Восьмиконечная звезда', pick: null, note: 'темнее фон' },
    ]);
  });

  test('текст не из листа, недописанная строка или картинка в двух группах — ошибка', () => {
    expect(() => parseDecisions('Да (1): Розетка (rozetka)')).toThrow('не заголовок');
    expect(() => parseDecisions('Узоры 0.15.6 — отбор картинок, 2026-10-17\nМожет быть (1): Розетка (rozetka)')).toThrow('не из листа');
    expect(() => parseDecisions('Узоры 0.15.6 — отбор картинок, 2026-10-17\nДа (2): Розетка (rozetka)')).toThrow('строку не понять');
    expect(() => parseDecisions('Узоры 0.15.6 — отбор картинок, 2026-10-17\nДа (1): Розетка (rozetka)\nНет (1): Розетка (rozetka)')).toThrow('в двух группах');
  });

  test('«да» — строка approved в конце карточки; у карточки с «да» ничего не меняется', () => {
    expect(approve('id: rozetka\ntitle: Розетка\n', '2026-10-17')).toEqual({ yaml: 'id: rozetka\ntitle: Розетка\napproved: 2026-10-17\n', changed: true });
    expect(approve('id: rozetka\ntitle: Розетка', '2026-10-17').yaml).toBe('id: rozetka\ntitle: Розетка\napproved: 2026-10-17\n');
    const done = 'id: rozetka\napproved: 2026-10-03\n';
    expect(approve(done, '2026-10-17')).toEqual({ yaml: done, changed: false });
  });

  test('«нет» картинке с «да» — hidden в конце карточки и слова владельца над ним (ADR 0010); без «да» — ничего', () => {
    const d = { date: '2026-10-24', version: '0.15.9', note: 'Недостаточно детализации' };
    expect(hide('id: pg-senokos\napproved: 2026-10-03', d)).toEqual({
      yaml: [
        'id: pg-senokos',
        'approved: 2026-10-03',
        '# «Нет» владельца 2026-10-24 в «Листе узоров» 0.15.9: «Недостаточно детализации».',
        '# Скрыта (ADR 0010): узор — в наборе для начатых работ, в библиотеке и календаре картинки нет.',
        '# Вернуть — новой версией узора (`v`, `was`) и новым «да».',
        'hidden: true',
        '',
      ].join('\n'),
      changed: true,
    });
    expect(hide('id: mak\napproved: 2026-10-03\n', { ...d, note: '' }).yaml).toContain('в «Листе узоров» 0.15.9.\n');
    for (const same of ['id: mak\n', 'id: mak\napproved: 2026-10-03\nhidden: true\n']) expect(hide(same, d)).toEqual({ yaml: same, changed: false });
  });
});
