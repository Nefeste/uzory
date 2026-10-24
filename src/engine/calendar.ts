// Календарь картинок дня (docs/09-content.md, §9). Расписанное в наборах — как есть;
// за его концом картинкой дня становится ещё не бывшая картинкой дня малая или средняя
// картинка библиотеки, кроме «Детям» (они бесплатны всегда — их день ничего не дарит), выбранная
// по дате: у всех с одинаковой библиотекой — одна и та же. Так же и день расписания, чью картинку
// потом скрыли («нет» владельца после «да», ADR 0010): пустых дней в календаре нет.
import { addDays, daysBetween } from './dates';
import type { CalendarDay, Picture } from './library';
import { dailySize } from './pattern';
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
  /** дни расписания до последнего, чья картинка скрыта: им — запасная, как за концом расписания */
  private readonly gaps = new Set<string>();
  private cursor: string | undefined;

  constructor(src: DailySource) {
    this.pinned = src.pinned ?? {};
    const known = new Set(src.pictures.filter((p) => !p.hidden).map((p) => p.id));
    let first: string | undefined;
    let last: string | undefined;
    for (const d of src.calendar) {
      if (this.planned.has(d.date)) continue;
      if (known.has(d.picture)) this.planned.set(d.date, d.picture);
      else this.gaps.add(d.date);
    }
    for (const date of this.planned.keys()) {
      this.gaps.delete(date);
      if (first === undefined || date < first) first = date;
      if (last === undefined || date > last) last = date;
    }
    // скрытые дни за последним расписанным — просто дни за концом расписания
    for (const date of this.gaps) {
      if (last === undefined || date > last) this.gaps.delete(date);
      else if (first === undefined || date < first) first = date;
    }
    this.first = first;
    this.last = last;
    this.cursor = last;
    for (const [date, id] of Object.entries(this.pinned)) this.mark(id, date);
    for (const [date, id] of this.planned) if (this.pinned[date] === undefined) this.mark(id, date);
    for (const id of this.planned.values()) this.used.add(id);
    this.pool = src.pictures
      .filter((p) => !p.hidden && dailySize(p.size) && p.collection !== 'kids')
      .map((p) => p.id)
      .sort();
    for (const date of [...this.gaps].sort()) if (this.pinned[date] === undefined) this.pick(date);
  }

  /** Картинка дня на дату; до начала календаря и в пропусках расписания — undefined. */
  on(date: string): string | undefined {
    const pin = this.pinned[date];
    if (pin !== undefined) return pin;
    const planned = this.planned.get(date);
    if (planned !== undefined) return planned;
    if (this.gaps.has(date)) return this.fallback.get(date);
    if (this.last === undefined || date <= this.last) return undefined;
    this.extendTo(date);
    return this.fallback.get(date);
  }

  /** Дата за расписанием или со скрытой картинкой: её картинку src/state закрепляет в `pinned`, когда показал. */
  isFallback(date: string): boolean {
    return this.pinned[date] === undefined && (this.gaps.has(date) || (this.last !== undefined && date > this.last));
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
      if (!this.pick(d)) return;
    }
  }

  /** Запасная картинка дня `d` — ещё не бывшая картинкой дня, по дате; выбирать не из чего — false. */
  private pick(d: string): boolean {
    let left = this.pool.filter((id) => !this.used.has(id));
    if (!left.length) {
      // всё уже было картинкой дня — круг начинается заново, в том же порядке у всех
      this.used.clear();
      left = this.pool;
    }
    if (!left.length) return false;
    const id = left[hash32(d) % left.length];
    this.fallback.set(d, id);
    this.mark(id, d);
    return true;
  }
}
