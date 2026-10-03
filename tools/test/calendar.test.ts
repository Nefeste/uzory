// Календарь картинок дня во встроенном наборе (docs/09-content.md, §8–9): коллекции
// вперемешку, две одной подряд — только когда больше нечего; время года — в свой сезон
// вразбивку, праздник — в свой день.
import { describe, expect, test } from 'bun:test';
import type { CollectionId, Picture } from '../../src/engine/library';
import type { SizeClass } from '../../src/engine/pattern';
import { autoCalendar, seasonOf } from '../content/build';
import type { Season } from '../content/cards';

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
    const pics = [...many(20, 'ornaments'), ...many(6, 'flowers'), ...many(6, 'kids')];
    const cal = autoCalendar(pics, '2026-10-01');
    const col = collectionOf(pics);
    const seq = cal.map((d) => col.get(d.picture));
    expect(cal.length).toBe(32);
    expect(new Set(cal.map((d) => d.picture)).size).toBe(32);
    // пока есть цветы и картинки «Детям», орнамент — через день, а они чередуются между собой
    for (let i = 1; i < 24; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(seq.slice(0, 6)).toEqual(['ornaments', 'flowers', 'ornaments', 'kids', 'ornaments', 'flowers']);
    // даты подряд, с первого дня
    expect(cal[0].date).toBe('2026-10-01');
    expect(cal[31].date).toBe('2026-11-01');
  });

  test('большие и огромные, скрытые — не в календаре', () => {
    const hidden = { ...pic('h', 'flowers'), hidden: true as const };
    const cal = autoCalendar([pic('a', 'flowers'), pic('b', 'painting', 'L'), pic('c', 'russia', 'XL'), hidden, pic('d', 'kids', 'M')], '2026-10-01');
    expect(cal.map((d) => d.picture).sort()).toEqual(['a', 'd']);
  });

  test('картинка со временем года — только в свой сезон, в свою долю его', () => {
    const pics = [...many(40, 'ornaments'), ...many(40, 'flowers'), pic('snegovik', 'kids'), pic('arbuz', 'kids')];
    const season = new Map<string, Season>([['snegovik', 'winter'], ['arbuz', 'summer']]);
    // с 25 ноября: зима — 1 декабря … 28 февраля, одна зимняя картинка — не раньше середины;
    // арбуз до лета не доходит
    const cal = autoCalendar(pics, '2026-11-25', { season });
    const day = (id: string) => cal.find((d) => d.picture === id)?.date;
    expect(day('snegovik')).toBe('2027-01-15');
    expect(day('arbuz')).toBeUndefined();
  });

  test('картинки одного сезона — вразбивку по нему, а не в первые дни', () => {
    const pics = [...many(60, 'ornaments'), ...many(60, 'flowers'), pic('a', 'kids'), pic('b', 'kids'), pic('c', 'kids')];
    const season = new Map<string, Season>([['a', 'autumn'], ['b', 'autumn'], ['c', 'autumn']]);
    // осень с 28 сентября — 64 дня до 1 декабря: доли — 16, 32 и 48 дней
    const cal = autoCalendar(pics, '2026-09-28', { season });
    const dates = ['a', 'b', 'c'].map((id) => cal.find((d) => d.picture === id)!.date);
    expect(dates).toEqual(['2026-10-14', '2026-10-30', '2026-11-15']);
  });

  test('картинка с днём — ровно в свой праздник; накануне — другая коллекция', () => {
    // три коллекции: накануне праздника «Детям» — не орнамент вчерашний и не «Детям», а цветы
    const pics = [...many(50, 'ornaments'), ...many(30, 'flowers'), ...many(30, 'kids'), pic('yolochka', 'kids')];
    const cal = autoCalendar(pics, '2026-11-25', { day: new Map([['yolochka', '12-31']]) });
    const i = cal.findIndex((d) => d.picture === 'yolochka');
    expect(cal[i].date).toBe('2026-12-31');
    const col = collectionOf(pics);
    expect(col.get(cal[i - 1].picture)).not.toBe('kids');
    expect(col.get(cal[i + 1].picture)).not.toBe('kids');
  });

  test('праздник, до которого календарь не дотянется, — картинки нет', () => {
    const pics = [...many(3, 'ornaments'), ...many(3, 'flowers'), pic('tyulpan', 'kids')];
    const cal = autoCalendar(pics, '2026-10-01', { day: new Map([['tyulpan', '03-08']]) });
    expect(cal.map((d) => d.picture)).not.toContain('tyulpan');
    expect(cal.length).toBe(6);
  });

  test('остались одни картинки других сезонов — календарь кончается', () => {
    const pics = [pic('a', 'flowers'), pic('snegovik', 'kids')];
    const cal = autoCalendar(pics, '2026-06-01', { season: new Map([['snegovik', 'winter' as Season]]) });
    expect(cal.map((d) => d.picture)).toEqual(['a']);
  });

  test('тот же набор — тот же календарь', () => {
    const pics = [...many(9, 'ornaments'), ...many(4, 'flowers'), ...many(3, 'kids'), ...many(2, 'schemes')];
    expect(autoCalendar(pics, '2026-10-01')).toEqual(autoCalendar(pics, '2026-10-01'));
  });
});
