// Счётчики суток и свёртка журнала (docs/03-server-api.md, «Счётчики»; docs/04-data-model.md,
// «Счётчики на сервере»; docs/06-testing.md, «Счётчики»): корзины как в таблице, строка
// запроса — ровно её параметры, день не считается дважды; свёртка берёт только законченные дни
// и только известные значения, строки журнала старше семи дней удаляются.
import { describe, expect, test } from 'bun:test';
import {
  addFinished, addStitch, daysBucket, finishedBucket, minutesBucket, normalizeCounters, NO_COUNTERS, rollDay, takeCounters,
} from '../../src/engine/counters';
import { csvDates, fold, HEADER, keepRecent, parseLine } from '../../server/stats/fold';

describe('корзины', () => {
  test('дни с установки: 0–7 точно, дальше промежутками', () => {
    expect([0, 1, 7, 8, 13, 14, 29, 30, 59, 60, 400].map(daysBucket)).toEqual(['0', '1', '7', '8-13', '8-13', '14-29', '14-29', '30-59', '30-59', '60+', '60+']);
  });
  test('картинки: 0, 1, 2, 3–5, 6+; минуты: 0, 1–5, 6–15, 16–30, 31–60, больше 60', () => {
    expect([0, 1, 2, 3, 5, 6, 40].map(finishedBucket)).toEqual([0, 1, 2, 3, 3, 4, 4]);
    expect([0, 1, 5, 6, 15, 16, 30, 31, 60, 61, 600].map(minutesBucket)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe('счётчики на телефоне', () => {
  const min = (day: string, hh: number, mm: number) => Math.floor(Date.parse(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`) / 60000);

  test('минута со стежком засчитывается один раз; картинки считаются', () => {
    let s = NO_COUNTERS;
    for (const m of [min('2026-10-12', 9, 0), min('2026-10-12', 9, 0), min('2026-10-12', 9, 1), min('2026-10-12', 21, 30)]) s = addStitch(s, '2026-10-12', m);
    s = addFinished(s, '2026-10-12');
    expect(s.cur).toMatchObject({ day: '2026-10-12', minutes: 3, finished: 1 });
    expect(addStitch(s, '2026-10-12', min('2026-10-12', 21, 30))).toBe(s);
  });

  test('первый запрос нового дня несёт итоги прошлого дня игры, повтор — без счётчиков', () => {
    let s = addStitch(NO_COUNTERS, '2026-10-12', min('2026-10-12', 9, 0));
    for (let i = 0; i < 3; i++) s = addFinished(s, '2026-10-12');
    const o = { v: '1.0.0', store: 'rustore' as const, installed: '2026-10-09', plus: false };
    const first = takeCounters(s, { ...o, today: '2026-10-13' });
    expect(first.query).toBe('v=1.0.0&s=rustore&c=2026-10-05&d=4&p=0&f=3&m=1');
    expect(first.next.prev).toBeNull();
    expect(takeCounters(first.next, { ...o, today: '2026-10-13' }).query).toBeNull();
    // назавтра — снова, но итоги уже отданы: нули
    expect(takeCounters(first.next, { ...o, today: '2026-10-14' }).query).toBe('v=1.0.0&s=rustore&c=2026-10-05&d=5&p=0&f=0&m=0');
  });

  test('день установки, подписка, «60+» в строке запроса — закодировано', () => {
    const q = takeCounters(NO_COUNTERS, { v: '1.2.3', store: 'apk', installed: '2026-01-01', today: '2026-10-12', plus: true }).query;
    expect(q).toBe('v=1.2.3&s=apk&c=2025-12-29&d=60%2B&p=1&f=0&m=0');
    expect(takeCounters(NO_COUNTERS, { v: '1.0.0', store: 'web', installed: '2026-10-12', today: '2026-10-12', plus: false }).query)
      .toBe('v=1.0.0&s=web&c=2026-10-12&d=0&p=0&f=0&m=0');
  });

  test('неотданный день теряется, досылается только последний; часы назад — копится заново', () => {
    let s = addFinished(NO_COUNTERS, '2026-10-10');
    s = rollDay(s, '2026-10-11');
    s = addFinished(addFinished(s, '2026-10-11'), '2026-10-11');
    s = rollDay(s, '2026-10-12');
    expect(s.prev).toMatchObject({ day: '2026-10-11', finished: 2 });
    expect(rollDay(addFinished(NO_COUNTERS, '2026-10-12'), '2026-10-11').cur).toBeNull();
  });

  test('испорченное хранилище — пусто', () => {
    expect(normalizeCounters('мусор')).toEqual(NO_COUNTERS);
    expect(normalizeCounters({ cur: { day: '2026-02-30', finished: 1 }, sentOn: 5 })).toEqual(NO_COUNTERS);
    expect(normalizeCounters({ cur: { day: '2026-10-12', finished: -3, minutes: 2.5 } }).cur).toEqual({ day: '2026-10-12', finished: 0, minutes: 0, lastMinute: -1 });
  });
});

describe('свёртка журнала на сервере', () => {
  const q = 'v=1.0.0&s=rustore&c=2026-10-05&d=3&p=0&f=2&m=3';
  const line = (date: string, uri: string, code = 200) => `${date}T08:15:02+03:00 "${uri}" ${code}`;
  const log = [
    line('2026-10-10', `/uzory/v1/catalog.json?${q}`),
    line('2026-10-11', `/uzory/v1/catalog.json?${q}`),
    line('2026-10-11', `/uzory/v1/catalog.json?${q}`, 304),
    line('2026-10-11', '/uzory/v1/catalog.json?v=1.0.0&s=web&c=2026-10-05&d=60%2B&p=1&f=0&m=0'),
    line('2026-10-11', '/uzory/v1/catalog.json'), // повтор без счётчиков
    line('2026-10-11', `/uzory/v1/catalog.json?${q}`, 404),
    line('2026-10-11', `/uzory/v1/catalog.json?${q}&x=1`), // лишний параметр
    line('2026-10-11', '/uzory/v1/catalog.json?v=1.0.0&s=<script>&c=2026-10-05&d=3&p=0&f=2&m=3'),
    line('2026-10-11', '/uzory/v1/catalog.json?v=1.0.0&s=apk&c=2026-10-05&d=3&p=0&f=2&m=3&m=4'), // дубль
    line('2026-10-11', `/uzory/v1/packs/w.pack?${q}`),
    '192.168.1.5 - - [11/Oct/2026] "GET /uzory/v1/catalog.json" 200', // чужой формат — с адресом
    line('2026-10-12', `/uzory/v1/catalog.json?${q}`), // сегодня — ещё не законченный день
  ];

  test('только полные строки со счётчиками и кодом 200/304', () => {
    expect(parseLine(log[0])).toEqual({ date: '2026-10-10', key: '1.0.0,rustore,2026-10-05,3,0,2,3' });
    expect(parseLine(log[3])?.key).toBe('1.0.0,web,2026-10-05,60+,1,0,0');
    expect(log.slice(4, 11).map(parseLine)).toEqual([null, null, null, null, null, null, null]);
  });

  test('законченные дни, которых ещё нет в таблице; в таблице — только корзины', () => {
    const r = fold(log, new Set(['2026-10-10']), '2026-10-12');
    expect(r.dates).toEqual(['2026-10-11']);
    expect(r.rows).toEqual(['2026-10-11,1.0.0,rustore,2026-10-05,3,0,2,3,2', '2026-10-11,1.0.0,web,2026-10-05,60+,1,0,0,1']);
    expect(r.rows.join('\n')).not.toMatch(/192\.168|script/);
    expect(csvDates(`${HEADER}\n2026-10-10,1.0.0,rustore,2026-10-05,3,0,2,3,1\n`)).toEqual(new Set(['2026-10-10']));
  });

  test('строки старше семи дней и без даты — прочь', () => {
    const kept = keepRecent([line('2026-10-04', '/a'), line('2026-10-05', '/b'), line('2026-10-12', '/c'), '192.168.1.5 - -'], '2026-10-12');
    expect(kept).toEqual([line('2026-10-05', '/b'), line('2026-10-12', '/c')]);
  });
});
