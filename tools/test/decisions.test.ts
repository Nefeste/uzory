// Текст решений «Листа узоров» (src/state/decisions.ts): комментарий владельца — что поправить —
// стоит после своей картинки; картинки с одним комментарием, без отметки, — своей группой; пустой
// и пробельный комментарий — не комментарий. С 0.16.2 отметка и комментарий — у версии картинки, и
// версия же — в тексте: «Название (id@v)».
// Обратно его разбирает tools/content/decisions.ts: что прислал владелец — то и в карточках.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIZES } from '../../src/engine/build/checks';
import { ru } from '../../src/i18n/ru';
import { cleanNote, decisionGroups, NOTE_MAX, pickKey, type Tune } from '../../src/state/decisions';
import { type Card, CONTENT, type PatternSpec, patternSpec, readCard } from '../content/cards';
import { approve, hide, parseDecisions, parseTune, retune, staleDecisions, tuneChanges } from '../content/decisions';

const rows = [
  { id: 'first-picture', v: 1, title: 'Первая картинка' },
  { id: 'rozetka', v: 1, title: 'Розетка' },
  { id: 'zvezda-alatyr', v: 1, title: 'Восьмиконечная звезда' },
  { id: 'kids-kit', v: 2, title: 'Кит' },
];
const text = (picks: Parameters<typeof decisionGroups>[1], notes: Parameters<typeof decisionGroups>[2]) =>
  ru.sheet.picksText('0.16.2', '2026-10-25', decisionGroups(rows, picks, notes, ru.sheet));

describe('решения листа', () => {
  test('комментарий — после картинки, в кавычках; картинки только с комментарием — своей группой', () => {
    expect(text({ 'first-picture@1': 'yes', 'rozetka@1': 'no', 'kids-kit@2': 'no' }, { 'rozetka@1': 'мелко, не видно лепестков', 'zvezda-alatyr@1': 'темнее фон' })).toBe([
      'Узоры 0.16.2 — отбор картинок, 2026-10-25',
      'Да (1): Первая картинка (first-picture@1)',
      'Нет (2): Розетка (rozetka@1) — «мелко, не видно лепестков», Кит (kids-kit@2)',
      'Без отметки, с комментарием (1): Восьмиконечная звезда (zvezda-alatyr@1) — «темнее фон»',
    ].join('\n'));
  });

  test('без комментариев — группы по порядку листа, пустые не пишутся', () => {
    expect(text({ 'kids-kit@2': 'later', 'first-picture@1': 'yes', 'rozetka@1': 'yes' }, {})).toBe([
      'Узоры 0.16.2 — отбор картинок, 2026-10-25',
      'Да (2): Первая картинка (first-picture@1), Розетка (rozetka@1)',
      'Позже (1): Кит (kids-kit@2)',
    ].join('\n'));
  });

  test('отметка прежней версии к новой не переходит: новая версия узора — без отметки и комментария', () => {
    // «Кит» пересобран: v 2 → 3; отметка и комментарий остались у версии 2
    const rebuilt = rows.map((r) => (r.id === 'kids-kit' ? { ...r, v: 3 } : r));
    const groups = decisionGroups(rebuilt, { 'kids-kit@2': 'no', 'rozetka@1': 'yes' }, { 'kids-kit@2': 'бледный' }, ru.sheet);
    expect(groups.flatMap(([, items]) => items)).toEqual(['Розетка (rozetka@1)']);
    expect(pickKey({ id: 'kids-kit', v: 3 })).toBe('kids-kit@3');
  });

  test('комментарий — одной строкой, без пробелов по краям и не длиннее предела', () => {
    expect(cleanNote('  мелко\n  и   темно  ')).toBe('мелко и темно');
    expect(cleanNote(' \n\t ')).toBe('');
    expect(cleanNote('а'.repeat(NOTE_MAX + 50))).toHaveLength(NOTE_MAX);
    expect(cleanNote(`${'а'.repeat(NOTE_MAX - 1)} б`)).toBe('а'.repeat(NOTE_MAX - 1));
  });
});

describe('текст решений → карточки (tools/content/decisions.ts)', () => {
  test('разбор — те же отметки, комментарии и версии, что в листе; запятые в названии и в комментарии не мешают', () => {
    const many = [...rows, { id: 'khram-very-nadezhdy-lyubvi', v: 1, title: 'Храм Веры, Надежды, Любови и матери их Софии' }];
    const picks = { 'first-picture@1': 'yes', 'khram-very-nadezhdy-lyubvi@1': 'yes', 'rozetka@1': 'no', 'kids-kit@2': 'later' } as const;
    const notes = { 'rozetka@1': 'мелко, не видно (совсем) лепестков', 'zvezda-alatyr@1': 'темнее фон', 'kids-kit@2': 'кит бледный' };
    const d = parseDecisions(ru.sheet.picksText('0.16.2', '2026-10-25', decisionGroups(many, picks, notes, ru.sheet)));
    expect(d.version).toBe('0.16.2');
    expect(d.date).toBe('2026-10-25');
    expect(d.items).toEqual([
      { id: 'first-picture', v: 1, title: 'Первая картинка', pick: 'yes', note: '' },
      { id: 'khram-very-nadezhdy-lyubvi', v: 1, title: 'Храм Веры, Надежды, Любови и матери их Софии', pick: 'yes', note: '' },
      { id: 'rozetka', v: 1, title: 'Розетка', pick: 'no', note: 'мелко, не видно (совсем) лепестков' },
      { id: 'kids-kit', v: 2, title: 'Кит', pick: 'later', note: 'кит бледный' },
      { id: 'zvezda-alatyr', v: 1, title: 'Восьмиконечная звезда', pick: null, note: 'темнее фон' },
    ]);
  });

  test('текст до 0.16.2 — без версий: разбирается как раньше', () => {
    const d = parseDecisions('Узоры 0.15.9 — отбор картинок, 2026-10-24\nДа (1): Розетка (rozetka)\nНет (1): Заяц (zayats) — «бледно»');
    expect(d.items).toEqual([
      { id: 'rozetka', title: 'Розетка', pick: 'yes', note: '' },
      { id: 'zayats', title: 'Заяц', pick: 'no', note: 'бледно' },
    ]);
  });

  test('текст не из листа, недописанная строка или картинка в двух группах — ошибка', () => {
    expect(() => parseDecisions('Да (1): Розетка (rozetka@1)')).toThrow('не заголовок');
    expect(() => parseDecisions('Узоры 0.16.2 — отбор картинок, 2026-10-25\nМожет быть (1): Розетка (rozetka@1)')).toThrow('не из листа');
    expect(() => parseDecisions('Узоры 0.16.2 — отбор картинок, 2026-10-25\nДа (2): Розетка (rozetka@1)')).toThrow('строку не понять');
    expect(() => parseDecisions('Узоры 0.16.2 — отбор картинок, 2026-10-25\nДа (1): Розетка (rozetka@1)\nНет (1): Розетка (rozetka@1)')).toThrow('в двух группах');
  });

  test('решение по другой версии, чем в карточке, — в список ошибок; без версии в тексте — не сверяется', () => {
    const d = parseDecisions('Узоры 0.16.2 — отбор картинок, 2026-10-25\nДа (2): Розетка (rozetka@1), Кит (kids-kit@2)\nНет (1): Мак (mak)');
    const v: Record<string, number> = { rozetka: 1, 'kids-kit': 3, mak: 2 };
    expect(staleDecisions(d.items, (id) => v[id])).toEqual(['kids-kit@2 (в карточке — v 3)']);
  });

  test('«да» — строка approved в конце карточки; у карточки с «да» ничего не меняется', () => {
    expect(approve('id: rozetka\ntitle: Розетка\n', '2026-10-17')).toEqual({ yaml: 'id: rozetka\ntitle: Розетка\napproved: 2026-10-17\n', changed: true });
    expect(approve('id: rozetka\ntitle: Розетка', '2026-10-17').yaml).toBe('id: rozetka\ntitle: Розетка\napproved: 2026-10-17\n');
    const done = 'id: rozetka\napproved: 2026-10-03\n';
    expect(approve(done, '2026-10-17')).toEqual({ yaml: done, changed: false });
  });

  test('«да» новой версии на повторном отборе — approved_v снят, дата — новая', () => {
    const card = 'id: pg-senokos\nv: 2\nwas:\n  1: { size: 300 }\napproved: 2026-10-03\napproved_v: 1\n';
    expect(approve(card, '2026-10-27')).toEqual({ yaml: 'id: pg-senokos\nv: 2\nwas:\n  1: { size: 300 }\napproved: 2026-10-27\n', changed: true });
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

  test('«нет» новой версии на повторном отборе — скрыта, прежняя с «да» остаётся для начатых работ', () => {
    const d = { date: '2026-10-27', version: '0.16.3', note: 'всё ещё бледно' };
    expect(hide('id: pg-senokos\nv: 2\napproved: 2026-10-03\napproved_v: 1\n', d).yaml).toBe([
      'id: pg-senokos',
      'v: 2',
      'approved: 2026-10-03',
      'approved_v: 1',
      '# «Нет» владельца 2026-10-27 в «Листе узоров» 0.16.3: «всё ещё бледно» — новой версии на повторном отборе.',
      '# Скрыта: прежняя версия с «да» (approved_v) — в наборе для начатых работ (ADR 0010).',
      'hidden: true',
      '',
    ].join('\n'));
  });
});

/** Карточка во временной папке коллекции — так её читает tools/content. */
function cardAt(collection: string, id: string, yaml: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'uzory-tune-')), collection);
  mkdirSync(dir);
  writeFileSync(join(dir, `${id}.yaml`), yaml);
  return join(dir, `${id}.yaml`);
}
const real = (collection: string, id: string) => {
  const file = join(CONTENT, collection, `${id}.yaml`);
  return { yaml: readFileSync(file, 'utf8'), card: readCard(file).card! };
};
/** Поля узора без «как без поля»: упрощение и сглаживание 0 — то же, что их нет. */
const norm = (p: PatternSpec) => Object.fromEntries(Object.entries(p).filter(([k, v]) => !((k === 'simplify' || k === 'smooth') && !v)));
const versions = (c: Card) => [...Object.keys(c.was ?? {}).map(Number), c.v];

describe('настройки владельца (0.24.1): «да при таких клетках»', () => {
  const tunes: Record<string, Tune> = { 'rozetka@1': { size: 450, threads: 40, simplify: 1 }, 'zvezda-alatyr@1': { threads: 24 } };

  test('настройки — в фигурных скобках после картинки, до комментария; только настройки — в группе без отметки', () => {
    const t = ru.sheet.picksText('0.24.1', '2026-11-02', decisionGroups(rows, { 'rozetka@1': 'yes' }, { 'rozetka@1': 'мелко' }, ru.sheet, tunes));
    expect(t).toBe([
      'Узоры 0.24.1 — отбор картинок, 2026-11-02',
      'Да (1): Розетка (rozetka@1) {клеток 450, нитей 40, упрощение: немного} — «мелко»',
      'Без отметки, с комментарием (1): Восьмиконечная звезда (zvezda-alatyr@1) {нитей 24}',
    ].join('\n'));
    const d = parseDecisions(t);
    expect(d.items.map((it) => [it.id, it.pick, it.tune, it.note])).toEqual([
      ['rozetka', 'yes', { size: 450, threads: 40, simplify: 1 }, 'мелко'],
      ['zvezda-alatyr', null, { threads: 24 }, ''],
    ]);
  });

  test('незнакомое слово или число вне пределов — ошибка разбора', () => {
    expect(() => parseTune('клеток 2000', ru.sheet.tuneWords)).toThrow('вне пределов');
    // нитей — не больше, чем пропускает карточка «Огромной» (tools/content/cards.ts)
    expect(parseTune(`нитей ${SIZES.XL.threads[1]}`, ru.sheet.tuneWords)).toEqual({ threads: SIZES.XL.threads[1] });
    expect(() => parseTune(`нитей ${SIZES.XL.threads[1] + 1}`, ru.sheet.tuneWords)).toThrow('вне пределов');
    expect(() => parseTune('стежков 40', ru.sheet.tuneWords)).toThrow('не понять');
    expect(() => parseTune('упрощение: очень', ru.sheet.tuneWords)).toThrow('не понять');
    expect(parseTune('упрощение: нет', ru.sheet.tuneWords)).toEqual({ simplify: 0 });
  });

  test('«да» при настройках — новая версия с ними и «да» сразу; прежние версии — те же узоры', () => {
    // «Георгин»: версия 4 со сглаживанием, три прежних в was, «да» у версии 2 (approved_v)
    const { yaml, card } = real('nature', 'georgin');
    const out = retune(yaml, card, { size: 360, threads: 40, simplify: 1 }, { pick: 'yes', date: '2026-11-02', text: 'клеток 360, нитей 40, упрощение: немного' });
    const after = readCard(cardAt('nature', 'georgin', out.yaml));
    expect(after.errors).toEqual([]);
    const c = after.card!;
    expect(c.v).toBe(card.v + 1);
    for (const v of versions(card)) expect(norm(patternSpec(c, v))).toEqual(norm(patternSpec(card, v)));
    expect([c.pattern!.size, c.pattern!.threads, c.pattern!.simplify, c.pattern!.smooth]).toEqual([360, 40, 1, undefined]);
    expect([c.approved, c.approved_v]).toEqual(['2026-11-02', undefined]);
  });

  test('без «да» у карточки с «да» — прежняя версия остаётся в выпуске (approved_v), новая — на отбор', () => {
    const { yaml, card } = real('cities', 'brevenchatyy-dom');
    expect(card.approved_v).toBeUndefined();
    const out = retune(yaml, card, { size: 300 }, { pick: 'no', date: '2026-11-02', text: 'клеток 300' });
    const after = readCard(cardAt('cities', 'brevenchatyy-dom', out.yaml));
    expect(after.errors).toEqual([]);
    expect([after.card!.v, after.card!.pattern!.size, after.card!.approved_v]).toEqual([card.v + 1, 300, card.v]);
    for (const v of versions(card)) expect(norm(patternSpec(after.card!, v))).toEqual(norm(patternSpec(card, v)));
  });

  test('как в карточке — новой версии нет («да» — нынешней); у старинной схемы клетки и упрощение — нельзя', () => {
    const { yaml, card } = real('nature', 'georgin');
    expect(tuneChanges(card, { size: card.pattern!.size, threads: card.pattern!.threads })).toEqual({ set: {}, old: {} });
    expect(retune(yaml, card, { size: card.pattern!.size }, { pick: 'yes', date: '2026-11-02', text: '' })).toEqual(approve(yaml, '2026-11-02'));
    const scheme = real('schemes', 'berlin-girlyanda-roz');
    expect(tuneChanges(scheme.card, { size: 200 })).toContain('старинной схемы');
    expect(() => retune(scheme.yaml, scheme.card, { simplify: 2 }, { pick: 'yes', date: '2026-11-02', text: '' })).toThrow('старинной схемы');
  });
});
