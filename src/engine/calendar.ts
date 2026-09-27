// Календарь картинок дня (docs/09-content.md, §9). Расписанное в наборах — как есть;
// за его концом картинкой дня становится ещё не бывшая картинкой дня малая или средняя
// картинка библиотеки, выбранная по дате: у всех с одинаковой библиотекой — одна и та же.
import { addDays, daysBetween } from './dates';
import type { CalendarDay, Picture } from './library';
import { hash32 } from './seed';

export interface DailySource {
  /** расписанные дни из всех наборов */
  calendar: readonly CalendarDay[];
  pictures: readonly Picture[];
  /**
   * Дни, которые телефон уже показал по запасному правилу: они не меняются, даже если
   * потом придёт набор с расписанием на эти дни — картинка дня бесплатна навсегда.
   */
  pinned?: Readonly<Record<string, string>>;
}

export class Daily {
  /** первый и последний расписанные дни; до первого картинок дня нет */
  readonly first: string | undefined;
  readonly last: string | undefined;
  private readonly planned = new Map<string, string>();
  private readonly fallback = new Map<string, string>();
  private readonly pinned: Readonly<Record<string, string>>;
  private readonly dates = new Map<string, string[]>();
  private readonly pool: string[];
  private readonly used = new Set<string>();
  private cursor: string | undefined;

  constructor(src: DailySource) {
    this.pinned = src.pinned ?? {};
    const known = new Set(src.pictures.filter((p) => !p.hidden).map((p) => p.id));
    let first: string | undefined;
    let last: string | undefined;
    for (const d of src.calendar) {
      if (!known.has(d.picture) || this.planned.has(d.date)) continue;
      this.planned.set(d.date, d.picture);
      if (first === undefined || d.date < first) first = d.date;
      if (last === undefined || d.date > last) last = d.date;
    }
    this.first = first;
    this.last = last;
    this.cursor = last;
    for (const [date, id] of Object.entries(this.pinned)) this.mark(id, date);
    for (const [date, id] of this.planned) if (this.pinned[date] === undefined) this.mark(id, date);
    for (const id of this.planned.values()) this.used.add(id);
    this.pool = src.pictures
      .filter((p) => !p.hidden && p.size !== 'L')
      .map((p) => p.id)
      .sort();
  }

  /** Картинка дня на дату; до начала календаря и в пропусках расписания — undefined. */
  on(date: string): string | undefined {
    const pin = this.pinned[date];
    if (pin !== undefined) return pin;
    const planned = this.planned.get(date);
    if (planned !== undefined) return planned;
    if (this.last === undefined || date <= this.last) return undefined;
    this.extendTo(date);
    return this.fallback.get(date);
  }

  /** Дата за расписанием: её картинку src/state закрепляет в `pinned`, когда показал. */
  isFallback(date: string): boolean {
    return this.pinned[date] === undefined && this.last !== undefined && date > this.last;
  }

  /** Первый день в [from, to], когда картинка была картинкой дня, или undefined. */
  dailyFrom(id: string, from: string, to: string): string | undefined {
    this.extendTo(to);
    const list = this.dates.get(id);
    if (!list) return undefined;
    let best: string | undefined;
    for (const d of list) if (d >= from && d <= to && (best === undefined || d < best)) best = d;
    return best;
  }

  /** Картинки дня с `from` по `to` включительно: дата → id. */
  range(from: string, to: string): Map<string, string> {
    const out = new Map<string, string>();
    const n = daysBetween(from, to);
    for (let i = 0; i <= n; i++) {
      const d = addDays(from, i);
      const id = this.on(d);
      if (id !== undefined) out.set(d, id);
    }
    return out;
  }

  private mark(id: string, date: string) {
    const list = this.dates.get(id);
    if (list) list.push(date);
    else this.dates.set(id, [date]);
    this.used.add(id);
  }

  private extendTo(date: string) {
    if (this.cursor === undefined) return;
    while (this.cursor < date) {
      const d = addDays(this.cursor, 1);
      this.cursor = d;
      if (this.pinned[d] !== undefined) continue;
      let left = this.pool.filter((id) => !this.used.has(id));
      if (!left.length) {
        // всё уже было картинкой дня — круг начинается заново, в том же порядке у всех
        this.used.clear();
        left = this.pool;
      }
      if (!left.length) return;
      const id = left[hash32(d) % left.length];
      this.fallback.set(d, id);
      this.mark(id, d);
    }
  }
}
