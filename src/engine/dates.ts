// Даты игры — строки «2026-10-05» по времени телефона. Движок сегодняшний день не узнаёт
// сам: его передаёт src/state (docs/02-architecture.md, «Слои приложения»).

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY = 86400000;

export function isDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return toDate(t) === s;
}

const toDate = (t: number) => new Date(t).toISOString().slice(0, 10);

function toTime(s: string): number {
  const m = DATE.exec(s);
  if (!m) throw new RangeError(`не дата: «${s}»`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

export const addDays = (date: string, n: number) => toDate(toTime(date) + n * DAY);

/** Сколько дней от `a` до `b` (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY);

/** Понедельник недели, в которую входит дата. */
export function mondayOf(date: string): string {
  const wd = new Date(toTime(date)).getUTCDay(); // 0 — воскресенье
  return addDays(date, -((wd + 6) % 7));
}

/** Местная дата телефона из времени и смещения пояса (минуты к востоку от UTC). */
export const localDate = (ms: number, offsetMin: number) => toDate(ms + offsetMin * 60000);

export const maxDate = (a: string, b: string) => (a > b ? a : b);
