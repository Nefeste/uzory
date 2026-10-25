// Календарь картинок дня во встроенном наборе (docs/09-content.md, §8–9): коллекции
// вперемешку, две одной подряд — только когда больше нечего; время года — в свой сезон
// вразбивку, праздник — в свой день; «Детям» — не в календаре; закреплённые дни
// (content/calendar.yaml) — как записаны.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { CollectionId, Picture } from '../../src/engine/library';
import type { SizeClass } from '../../src/engine/pattern';
import { autoCalendar, calendarPictures, FIXED_DAYS, readFixedDays, seasonOf } from '../content/build';
import { fixedYaml } from '../content/calendar';
import { CONTENT, listCards, readCard, releasableAt, type Season } from '../content/cards';

const pic = (id: string, collection: CollectionId, size: SizeClass = 'S'): Picture => ({
  id, v: 1, title: id, collection, order: 0, size, source: { url: '', basis: '' }, added: '2026-09-01',
});
const many = (n: number, collection: CollectionId) => Array.from({ length: n }, (_, i) => pic(`${collection}-${i}`, collection));
const collectionOf = (pics: Picture[]) => new Map(pics.map((p) => [p.id, p.collection]));

describe('календарь сборки', () => {
  test('время года по месяцу', () => {
    expect(seasonOf('2026-12-01')).toBe('winter');
    expect(seasonOf('2027-02-28')).toBe('winter');
    expect(seasonOf('2027-03-01')).toBe('spring');
    expect(seasonOf('2027-06-15')).toBe('summer');
    expect(seasonOf('2026-09-30')).toBe('autumn');
    expect(seasonOf('2026-11-30')).toBe('autumn');
  });

  test('коллекции вперемешку: две одной подряд — только когда больше нечего', () => {
    const pics = [...many(20, 'ornaments'), ...many(6, 'flowers'), ...many(6, 'schemes')];
    const cal = autoCalendar(pics, '2026-10-01');
    const col = collectionOf(pics);
    const seq = cal.map((d) => col.get(d.picture));
    expect(cal.length).toBe(32);
    expect(new Set(cal.map((d) => d.picture)).size).toBe(32);
    // пока есть цветы и старинные схемы, орнамент — через день, а они чередуются между собой
    for (let i = 1; i < 24; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(seq.slice(0, 6)).toEqual(['ornaments', 'flowers', 'ornaments', 'schemes', 'ornaments', 'flowers']);
    // даты подряд, с первого дня
    expect(cal[0].date).toBe('2026-10-01');
    expect(cal[31].date).toBe('2026-11-01');
  });

  test('большие и огромные, скрытые — не в календаре', () => {
    const hidden = { ...pic('h', 'flowers'), hidden: true as const };
    const cal = autoCalendar([pic('a', 'flowers'), pic('b', 'painting', 'L'), pic('c', 'russia', 'XL'), hidden, pic('d', 'tales', 'M')], '2026-10-01');
    expect(cal.map((d) => d.picture).sort()).toEqual(['a', 'd']);
  });

  test('«Детям» — не в календаре: бесплатны всегда, их день ничего не дарит (17.10.2026)', () => {
    const pics = [...many(4, 'flowers'), ...many(4, 'kids'), pic('yolochka', 'kids'), pic('maslenitsa', 'kids')];
    const cal = autoCalendar(pics, '2026-12-28', { day: new Map([['yolochka', '12-31']]), dates: new Map([['2026-12-30', 'maslenitsa']]) });
    expect(cal.map((d) => d.picture)).toEqual(['flowers-0', 'flowers-1', 'flowers-2', 'flowers-3']);
    // закреплённый день с картинкой «Детям» — как был: у игроков он прошёл
    const fixed = [{ date: '2026-12-28', picture: 'kids-0' }];
    expect(autoCalendar(pics, '2026-12-28', { fixed }).map((d) => d.picture)).toEqual(['kids-0', ...cal.map((d) => d.picture)]);
  });

  test('картинка со временем года — только в свой сезон, в свою долю его', () => {
    const pics = [...many(40, 'ornaments'), ...many(40, 'flowers'), pic('snegovik', 'tales'), pic('arbuz', 'tales')];
    const season = new Map<string, Season>([['snegovik', 'winter'], ['arbuz', 'summer']]);
    // с 25 ноября: зима — 1 декабря … 28 февраля, одна зимняя картинка — не раньше середины;
    // арбуз до лета не доходит
    const cal = autoCalendar(pics, '2026-11-25', { season });
    const day = (id: string) => cal.find((d) => d.picture === id)?.date;
    expect(day('snegovik')).toBe('2027-01-15');
    expect(day('arbuz')).toBeUndefined();
  });

  test('картинки одного сезона — вразбивку по нему, а не в первые дни', () => {
    const pics = [...many(60, 'ornaments'), ...many(60, 'flowers'), pic('a', 'tales'), pic('b', 'tales'), pic('c', 'tales')];
    const season = new Map<string, Season>([['a', 'autumn'], ['b', 'autumn'], ['c', 'autumn']]);
    // осень с 28 сентября — 64 дня до 1 декабря: доли — 16, 32 и 48 дней
    const cal = autoCalendar(pics, '2026-09-28', { season });
    const dates = ['a', 'b', 'c'].map((id) => cal.find((d) => d.picture === id)!.date);
    expect(dates).toEqual(['2026-10-14', '2026-10-30', '2026-11-15']);
  });

  test('картинка с днём — ровно в свой праздник; накануне — другая коллекция', () => {
    // три коллекции: накануне праздника сказок — не орнамент вчерашний и не сказка, а цветы
    const pics = [...many(50, 'ornaments'), ...many(30, 'flowers'), ...many(30, 'tales'), pic('yolochka', 'tales')];
    const cal = autoCalendar(pics, '2026-11-25', { day: new Map([['yolochka', '12-31']]) });
    const i = cal.findIndex((d) => d.picture === 'yolochka');
    expect(cal[i].date).toBe('2026-12-31');
    const col = collectionOf(pics);
    expect(col.get(cal[i - 1].picture)).not.toBe('tales');
    expect(col.get(cal[i + 1].picture)).not.toBe('tales');
  });

  test('праздник, до которого календарь не дотянется, — картинки нет', () => {
    const pics = [...many(3, 'ornaments'), ...many(3, 'flowers'), pic('tyulpan', 'tales')];
    const cal = autoCalendar(pics, '2026-10-01', { day: new Map([['tyulpan', '03-08']]) });
    expect(cal.map((d) => d.picture)).not.toContain('tyulpan');
    expect(cal.length).toBe(6);
  });

  test('остались одни картинки других сезонов — календарь кончается', () => {
    const pics = [pic('a', 'flowers'), pic('snegovik', 'tales')];
    const cal = autoCalendar(pics, '2026-06-01', { season: new Map([['snegovik', 'winter' as Season]]) });
    expect(cal.map((d) => d.picture)).toEqual(['a']);
  });

  test('тот же набор — тот же календарь', () => {
    const pics = [...many(9, 'ornaments'), ...many(4, 'flowers'), ...many(3, 'tales'), ...many(2, 'schemes')];
    expect(autoCalendar(pics, '2026-10-01')).toEqual(autoCalendar(pics, '2026-10-01'));
  });
});

describe('календарь набора недели', () => {
  test('не дальше заданных дней; первый день — не коллекция вчерашнего', () => {
    const pics = [...many(20, 'ornaments'), ...many(20, 'flowers')];
    const cal = autoCalendar(pics, '2026-10-01', {}, { days: 7, after: 'ornaments' });
    const col = collectionOf(pics);
    expect(cal).toHaveLength(7);
    expect(cal.at(-1)!.date).toBe('2026-10-07');
    expect(col.get(cal[0].picture)).toBe('flowers');
    expect(autoCalendar(pics, '2026-10-01', {}, { days: 0 })).toEqual([]);
  });

  test('день из набора недели — ровно в свою дату, важнее праздника карточки', () => {
    const pics = [...many(10, 'ornaments'), ...many(10, 'flowers'), pic('maslenitsa', 'tales'), pic('tyulpan', 'tales')];
    const dates = new Map([['2026-10-04', 'maslenitsa'], ['2026-10-05', 'tyulpan']]);
    const cal = autoCalendar(pics, '2026-10-01', { day: new Map([['tyulpan', '10-02']]), dates }, { days: 7 });
    const on = new Map(cal.map((d) => [d.date, d.picture]));
    expect(on.get('2026-10-04')).toBe('maslenitsa');
    expect(on.get('2026-10-05')).toBe('tyulpan');
    expect(on.get('2026-10-02')).not.toBe('tyulpan');
    expect(cal.filter((d) => d.picture === 'maslenitsa' || d.picture === 'tyulpan')).toHaveLength(2);
  });
});

describe('закреплённые дни', () => {
  const pics = [...many(30, 'ornaments'), ...many(20, 'flowers'), ...many(12, 'schemes'), pic('snegovik', 'flowers'), pic('yolochka', 'ornaments')];
  const rules = { season: new Map<string, Season>([['snegovik', 'winter']]), day: new Map([['yolochka', '12-31']]) };
  const cal = autoCalendar(pics, '2026-11-20', rules);

  test('само закрепление календарь не двигает: ни дней после, ни праздника, ни доли сезона', () => {
    expect(cal.find((d) => d.picture === 'yolochka')?.date).toBe('2026-12-31');
    for (const n of [1, 12, 45]) expect(autoCalendar(pics, '2026-11-20', { ...rules, fixed: cal.slice(0, n) })).toEqual(cal);
  });

  test('правка карточек после закрепления двигает только дни после закреплённых', () => {
    const fixed = cal.slice(0, 12);
    const more = [...pics, ...many(6, 'tales'), pic('vesna', 'flowers')];
    const next = autoCalendar(more, '2026-11-20', { season: new Map([...rules.season, ['vesna', 'spring']]), day: rules.day, fixed });
    expect(next.slice(0, 12)).toEqual(fixed);
    expect(next.slice(12)).not.toEqual(cal.slice(12));
    expect(new Set(next.map((d) => d.picture)).size).toBe(next.length);
  });

  test('закреплённый день — как записан, даже если картинка теперь не подошла бы календарю', () => {
    const big = pic('bolshaya', 'painting', 'L');
    const fixed = [{ date: '2026-11-20', picture: 'bolshaya' }, ...cal.slice(1, 3)];
    const next = autoCalendar([...pics, big], '2026-11-20', { ...rules, fixed });
    expect(next.slice(0, 3)).toEqual(fixed);
    expect(next.filter((d) => d.picture === 'bolshaya')).toHaveLength(1);
  });

  test('картинку закреплённого дня потом скрыли — день как был, новых дней у скрытых нет (24.10.2026)', () => {
    const fixed = cal.slice(0, 3);
    const gone = new Set([...fixed.map((d) => d.picture), cal[5].picture]);
    const next = autoCalendar(pics.map((p) => (gone.has(p.id) ? { ...p, hidden: true as const } : p)), '2026-11-20', { ...rules, fixed });
    expect(next.slice(0, 3)).toEqual(fixed);
    expect(next.slice(3).filter((d) => gone.has(d.picture))).toEqual([]);
  });

  test('картинка закреплённого дня — на повторном отборе: в выпуске только прежней версией, а день — как был (approved_v)', () => {
    const fixed = cal.slice(0, 3);
    const again = fixed[1].picture;
    const built = pics.filter((p) => p.id !== again).map((picture) => ({ picture }));
    const previous = [{ picture: { ...pics.find((p) => p.id === again)!, hidden: true as const } }];
    expect(autoCalendar(calendarPictures(built, previous), '2026-11-20', { ...rules, fixed }).slice(0, 3)).toEqual(fixed);
    // без прежней версии день выпал бы, и календарь сдвинулся бы с самого начала
    expect(autoCalendar(built.map((b) => b.picture), '2026-11-20', { ...rules, fixed }).slice(0, 3)).not.toEqual(fixed);
    // прежние версии картинки, у которой в наборе есть нынешняя, в календарь не добавляются
    expect(calendarPictures(built.slice(0, 2), [{ picture: { ...built[0].picture, hidden: true } }])).toEqual(built.slice(0, 2).map((b) => b.picture));
  });

  test('файл: дни подряд с calendar_from, картинка не дважды; файла нет — дней нет', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uzory-calendar-'));
    const file = (name: string, text: string) => {
      writeFileSync(join(dir, name), text);
      return join(dir, name);
    };
    const days = [{ date: '2026-09-28', picture: 'first-picture' }, { date: '2026-09-29', picture: 'rozetka' }];
    expect(readFixedDays('2026-09-28', file('ok.yaml', fixedYaml(days)))).toEqual(days);
    expect(readFixedDays('2026-09-28', join(dir, 'net.yaml'))).toEqual([]);
    expect(() => readFixedDays('2026-09-28', file('gap.yaml', '2026-09-28: a\n2026-09-30: b\n'))).toThrow('ждали 2026-09-29');
    expect(() => readFixedDays('2026-09-27', file('late.yaml', '2026-09-28: a\n'))).toThrow('ждали 2026-09-27');
    expect(() => readFixedDays('2026-09-28', file('twice.yaml', '2026-09-28: a\n2026-09-29: a\n'))).toThrow('дважды — a');
  });

  test('content/calendar.yaml: дни подряд с calendar_from, у каждой картинки — карточка с «да» (на повторном отборе — у прежней версии)', () => {
    const meta = parse(readFileSync(join(CONTENT, 'pack.yaml'), 'utf8')) as { calendar_from: string };
    const days = readFixedDays(meta.calendar_from);
    expect(days.length).toBeGreaterThan(0);
    const cards = new Map(listCards().map((f) => readCard(f).card).filter((c) => !!c).map((c) => [c!.id, c!]));
    const bad = days.filter((d) => !cards.has(d.picture) || releasableAt(cards.get(d.picture)!, cards.get(d.picture)!.approved_v ?? cards.get(d.picture)!.v) !== null);
    expect(bad).toEqual([]);
    expect(FIXED_DAYS).toBe(join(CONTENT, 'calendar.yaml'));
  });
});
