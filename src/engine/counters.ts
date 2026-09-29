// Счётчики суток (docs/03-server-api.md, «Счётчики»; docs/04-data-model.md, «Счётчики суток»;
// ADR 0012): несколько обезличенных чисел о прошлом дне игры в строке первого за день запроса
// каталога — корзинами, без номера установки и без чего-либо, что узнаёт человека. Движок
// только считает; когда копить и отдавать — src/state/counters.ts.
import { daysBetween, isDate, mondayOf } from './dates';

/** Откуда игра: магазин, APK из Releases или закрытая веб-версия. */
export type Store = 'rustore' | 'apk' | 'web';

/** Итоги дня игры. */
export interface DayCounters {
  day: string;
  /** картинок закончено */
  finished: number;
  /** минут, в которых был хотя бы один стежок */
  minutes: number;
  /** последняя засчитанная минута — номер минуты от 1970 года */
  lastMinute: number;
}

export interface Counters {
  /** последний день игры, копится */
  cur: DayCounters | null;
  /** прошлый день игры: уйдёт с первым запросом каталога нового дня */
  prev: DayCounters | null;
  /** день, в который счётчики уже отданы: второй попытке того же дня их не достанется */
  sentOn: string | null;
}

export const NO_COUNTERS: Counters = { cur: null, prev: null, sentOn: null };

/** Сколько дней с установки: 0–7 точно, дальше промежутками. */
export function daysBucket(d: number): string {
  if (d <= 7) return String(Math.max(0, d));
  if (d <= 13) return '8-13';
  if (d <= 29) return '14-29';
  if (d <= 59) return '30-59';
  return '60+';
}

/** Картинок за день: 0, 1, 2, 3–5, 6 и больше — номер корзины. */
export const finishedBucket = (n: number) => (n <= 2 ? Math.max(0, n) : n <= 5 ? 3 : 4);

/** Минут за день: 0, 1–5, 6–15, 16–30, 31–60, больше 60 — номер корзины. */
export const minutesBucket = (m: number) => (m <= 0 ? 0 : m <= 5 ? 1 : m <= 15 ? 2 : m <= 30 ? 3 : m <= 60 ? 4 : 5);

/**
 * Новый день: итоги прошлого дня игры становятся `prev` — их отдаст первый запрос каталога.
 * Неотданные итоги ещё более раннего дня теряются: досылается только последний день игры.
 * Часы переведены назад — сегодняшнее копится заново, а не пишется в «будущий» день.
 */
export function rollDay(s: Counters, today: string): Counters {
  if (!s.cur || s.cur.day === today) return s;
  if (s.cur.day > today) return { ...s, cur: null };
  return { ...s, cur: null, prev: s.cur };
}

const fresh = (today: string): DayCounters => ({ day: today, finished: 0, minutes: 0, lastMinute: -1 });

/** Стежок в минуту `minute`: минута дня засчитывается один раз. Ничего не изменилось — тот же объект. */
export function addStitch(s: Counters, today: string, minute: number): Counters {
  const r = rollDay(s, today);
  const cur = r.cur ?? fresh(today);
  if (cur.lastMinute === minute) return r;
  return { ...r, cur: { ...cur, minutes: cur.minutes + 1, lastMinute: minute } };
}

export function addFinished(s: Counters, today: string): Counters {
  const r = rollDay(s, today);
  const cur = r.cur ?? fresh(today);
  return { ...r, cur: { ...cur, finished: cur.finished + 1 } };
}

/**
 * Первая попытка дня: строка счётчиков и состояние, где итоги отданы. Сегодня уже отдавали —
 * `query` null: повтор после неудачи идёт без счётчиков, чтобы день не посчитался дважды.
 */
export function takeCounters(s: Counters, o: { v: string; store: Store; installed: string; today: string; plus: boolean }):
  { query: string | null; next: Counters } {
  const r = rollDay(s, o.today);
  if (r.sentOn === o.today || !isDate(o.installed) || !isDate(o.today)) return { query: null, next: r };
  const prev = r.prev;
  const q: [string, string][] = [
    ['v', o.v], ['s', o.store], ['c', mondayOf(o.installed)], ['d', daysBucket(daysBetween(o.installed, o.today))],
    ['p', o.plus ? '1' : '0'], ['f', String(prev ? finishedBucket(prev.finished) : 0)], ['m', String(prev ? minutesBucket(prev.minutes) : 0)],
  ];
  return { query: q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'), next: { ...r, prev: null, sentOn: o.today } };
}

/** Состояние из хранилища; чужое и испорченное — пустое. */
export function normalizeCounters(raw: unknown): Counters {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Counters>;
  const day = (d: unknown): DayCounters | null => {
    const x = d as Partial<DayCounters> | null;
    if (!x || typeof x.day !== 'string' || !isDate(x.day)) return null;
    const n = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
    return { day: x.day, finished: n(x.finished), minutes: n(x.minutes), lastMinute: Number.isInteger(x.lastMinute) ? (x.lastMinute as number) : -1 };
  };
  return { cur: day(r.cur), prev: day(r.prev), sentOn: typeof r.sentOn === 'string' && isDate(r.sentOn) ? r.sentOn : null };
}
