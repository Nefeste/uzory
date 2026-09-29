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

/** Месяц календаря: неделя с понедельника, пустые клетки до первого числа и после последнего — null. */
export interface MonthGrid {
  y: number;
  /** 0 — январь */
  m: number;
  days: (string | null)[];
}

/** Месяцы от месяца даты `to` назад до месяца даты `from` (docs/specs/2026-09-library.md, «Календарь»). */
export function monthGrids(from: string, to: string): MonthGrid[] {
  const out: MonthGrid[] = [];
  let y = +to.slice(0, 4);
  let m = +to.slice(5, 7) - 1;
  const fy = +from.slice(0, 4);
  const fm = +from.slice(5, 7) - 1;
  while (y > fy || (y === fy && m >= fm)) {
    const first = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const lead = (new Date(toTime(first)).getUTCDay() + 6) % 7;
    const days: (string | null)[] = Array<string | null>(lead).fill(null);
    for (let d = first; d.slice(5, 7) === first.slice(5, 7); d = addDays(d, 1)) days.push(d);
    while (days.length % 7) days.push(null);
    out.push({ y, m, days });
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return out;
}
