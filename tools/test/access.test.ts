// Доступность картинок и календарь (docs/06-testing.md, «Доступность», «Календарь»).
import { describe, expect, test } from 'bun:test';
import { access, type AccessContext } from '../../src/engine/access';
import { Daily } from '../../src/engine/calendar';
import { addDays, daysBetween, isDate, localDate, mondayOf, monthGrids } from '../../src/engine/dates';
import { nextPicture, type Picture } from '../../src/engine/library';

const pic = (id: string, over: Partial<Picture> = {}): Picture => ({
  id, v: 1, title: id, collection: 'painting', order: 10, size: 'M',
  source: { url: 'https://example.org', basis: 'PD' }, added: '2026-10-01', ...over,
});

describe('даты', () => {
  test('сложение, разность, понедельник, местная дата', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(daysBetween('2026-10-05', '2027-10-05')).toBe(365);
    expect(mondayOf('2026-10-11')).toBe('2026-10-05'); // воскресенье
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2026-02-28')).toBe(true);
    // 21:30 UTC 4 октября — уже 5-е в Москве (UTC+3)
    expect(localDate(Date.UTC(2026, 9, 4, 21, 30), 180)).toBe('2026-10-05');
  });
});

describe('календарь по месяцам', () => {
  test('от текущего месяца назад до месяца первого запуска, неделя с понедельника', () => {
    const g = monthGrids('2026-09-20', '2026-11-03');
    expect(g.map((x) => `${x.y}-${x.m + 1}`)).toEqual(['2026-11', '2026-10', '2026-9']);
    // 1 ноября 2026 — воскресенье: шесть пустых клеток перед ним
    expect(g[0].days.slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(g[0].days.length % 7).toBe(0);
    expect(g[2].days.filter(Boolean)).toHaveLength(30);
    // через Новый год
    expect(monthGrids('2026-12-31', '2027-01-01').map((x) => `${x.y}-${x.m + 1}`)).toEqual(['2027-1', '2026-12']);
  });
});

describe('access', () => {
  const daily: Record<string, string> = { day: '2026-10-05', before: '2026-09-01', tomorrow: '2026-10-06' };
  const ctx = (over: Partial<AccessContext> = {}): AccessContext => ({
    today: '2026-10-05', seen: '2026-10-05', installed: '2026-09-20',
    dailyFrom: (id) => daily[id], plus: false, hasWork: () => false, ...over,
  });

  test.each([
    ['первые пять коллекции бесплатны', pic('a', { order: 4 }), ctx(), 'free'],
    ['шестая — уже нет', pic('a', { order: 5 }), ctx(), 'locked'],
    ['«Детям» — всегда', pic('a', { order: 30, collection: 'kids', free: true }), ctx(), 'free'],
    ['сегодняшняя картинка дня', pic('day'), ctx(), 'daily'],
    ['вчерашняя — тоже', pic('day'), ctx({ today: '2026-10-06', seen: '2026-10-06' }), 'daily'],
    ['завтрашняя — ещё нет', pic('tomorrow'), ctx(), 'locked'],
    ['до первого запуска — нет', pic('before'), ctx(), 'locked'],
    ['часы назад: виденное остаётся', pic('tomorrow'), ctx({ today: '2026-10-01', seen: '2026-10-06' }), 'daily'],
    ['начатая без подписки', pic('x'), ctx({ hasWork: () => true }), 'started'],
    ['подписка', pic('x'), ctx({ plus: true }), 'plus'],
    ['подписка кончилась, работы нет', pic('x'), ctx({ plus: false }), 'locked'],
    ['подписка кончилась, работа есть — дошить', pic('x'), ctx({ plus: false, hasWork: () => true }), 'started'],
  ] as const)('%s', (_, p, c, want) => {
    expect(access(p, c)).toBe(want);
  });
});

describe('календарь', () => {
  const pictures: Picture[] = [];
  // малые и средние — половина: календарю хватает не бывших на 30 дней вперёд
  for (let i = 0; i < 80; i++) pictures.push(pic(`p${String(i).padStart(2, '0')}`, { size: (['S', 'M', 'L', 'XL'] as const)[i % 4] }));
  pictures.push(pic('gone', { hidden: true, size: 'S' }));
  const calendar = [0, 1, 3, 4].map((i) => ({ date: addDays('2026-10-01', i), picture: pictures[i === 2 ? 1 : i === 3 ? 4 : i].id }));

  test('расписанное — как есть, за концом — не бывшие, не большие, не скрытые', () => {
    const d = new Daily({ calendar, pictures });
    expect(d.on('2026-09-30')).toBeUndefined();
    expect(d.on('2026-10-01')).toBe('p00');
    expect(d.on('2026-10-03')).toBeUndefined(); // пропуск в расписании
    expect(d.last).toBe('2026-10-05');
    const range = d.range('2026-10-06', addDays('2026-10-06', 29));
    const ids = [...range.values()];
    expect(ids.length).toBe(30);
    expect(new Set(ids).size).toBe(30);
    for (const id of ids) {
      const p = pictures.find((q) => q.id === id)!;
      expect(['S', 'M']).toContain(p.size);
      expect(p.hidden).toBeUndefined();
      expect(calendar.some((c) => c.picture === id)).toBe(false);
    }
  });

  test('одинаково на любом телефоне с той же библиотекой — с какого дня ни спроси', () => {
    const a = new Daily({ calendar, pictures });
    const b = new Daily({ calendar, pictures: [...pictures].reverse() });
    const far = addDays('2026-10-05', 200);
    expect(b.on(far)).toBe(a.on(far));
    expect([...a.range('2026-10-06', far)]).toEqual([...b.range('2026-10-06', far)]);
  });

  test('когда кончились все, круг начинается заново', () => {
    const d = new Daily({ calendar, pictures });
    const all = [...d.range('2026-10-06', addDays('2026-10-06', 99)).values()];
    expect(all.every((x) => x !== undefined)).toBe(true);
  });

  test('закреплённые дни не меняются новым расписанием', () => {
    const shown = new Daily({ calendar, pictures }).on('2026-10-06')!;
    const later = [...calendar, { date: '2026-10-06', picture: 'p07' }];
    const d = new Daily({ calendar: later, pictures, pinned: { '2026-10-06': shown } });
    expect(d.on('2026-10-06')).toBe(shown);
    expect(d.dailyFrom(shown, '2026-09-20', '2026-10-06')).toBe('2026-10-06');
  });

  test('dailyFrom для access: только дни с установки по сегодня', () => {
    const d = new Daily({ calendar, pictures });
    expect(d.dailyFrom('p00', '2026-10-01', '2026-10-10')).toBe('2026-10-01');
    expect(d.dailyFrom('p00', '2026-10-02', '2026-10-10')).toBeUndefined();
    const next = d.on('2026-10-06')!;
    expect(d.dailyFrom(next, '2026-10-01', '2026-10-05')).toBeUndefined();
    expect(d.dailyFrom(next, '2026-10-01', '2026-10-06')).toBe('2026-10-06');
  });
});

describe('«Дальше» на «Готово»', () => {
  const list = ['a', 'b', 'c', 'd'].map((id, order) => pic(id, { order }));
  const [a, b, c, d] = list;
  const openExcept = (...ids: string[]) => (p: Picture) => !ids.includes(p.id);

  test('картинка дня, пока её можно вышить', () => {
    const daily = pic('day', { collection: 'nature' });
    expect(nextPicture(b, daily, list, openExcept())).toBe(daily);
    // вышита или вышивалась только что — следующая в коллекции
    expect(nextPicture(b, daily, list, openExcept('day'))).toBe(c);
    expect(nextPicture(daily, daily, [daily], openExcept())).toBeNull();
  });

  test('следующая по порядку, по кругу, мимо вышитых и закрытых', () => {
    expect(nextPicture(b, undefined, list, openExcept())).toBe(c);
    expect(nextPicture(b, undefined, list, openExcept('c'))).toBe(d);
    expect(nextPicture(d, undefined, list, openExcept())).toBe(a);
    expect(nextPicture(c, undefined, list, openExcept('d', 'a'))).toBe(b);
    // вся коллекция вышита — на главную; сама себя не предлагает
    expect(nextPicture(b, undefined, list, openExcept('a', 'c', 'd'))).toBeNull();
    // картинки нет в списке (скрыта) — с начала коллекции
    expect(nextPicture(pic('x'), undefined, list, openExcept('a'))).toBe(b);
  });
});
