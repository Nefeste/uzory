// Подписка «Узоры+» (docs/04-data-model.md, «Подписка»; docs/specs/2026-09-plus.md): права по
// последнему ответу RuStore Pay и когда игра сама говорит о подписке. Время и даты — аргументы:
// движок их не узнаёт сам.
import { addDays, daysBetween, isDate } from './dates';

/** Как сообщил RuStore Pay: действует, льготный период, приостановка, закрыта; `none` — не было. */
export type PlusStatus = 'none' | 'active' | 'grace' | 'hold' | 'closed';
export type PlusPeriod = 'month' | 'year';

export interface PlusState {
  status: PlusStatus;
  /** конец оплаченного срока, мс, если RuStore Pay его сообщил */
  until?: number;
  product?: PlusPeriod;
  /** когда спрашивали RuStore Pay, мс */
  checkedAt: number;
}

const STATUSES: readonly PlusStatus[] = ['none', 'active', 'grace', 'hold', 'closed'];

/** Без сети ответ без срока действует трое суток с последней проверки (docs/04-data-model.md). */
export const PLUS_OFFLINE_MS = 3 * 86400000;

/**
 * Строка «Узоры+» на «Готово» — не в первые три дня после установки и не чаще раза в сутки
 * (docs/08-game-design.md, «„Узоры+“ глазами игрока»).
 */
export const OFFER_AFTER_DAYS = 3;

/** Запись из хранилища — в порядок; чужое и испорченное — как «подписки не было». */
export function normalizePlus(raw: unknown): PlusState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!STATUSES.includes(r.status as PlusStatus) || typeof r.checkedAt !== 'number' || !Number.isFinite(r.checkedAt)) return null;
  const s: PlusState = { status: r.status as PlusStatus, checkedAt: r.checkedAt };
  if (typeof r.until === 'number' && Number.isFinite(r.until)) s.until = r.until;
  if (r.product === 'month' || r.product === 'year') s.product = r.product;
  return s;
}

/**
 * Открыта ли библиотека: при «действует» и «льготном периоде» — до конца оплаченного срока,
 * а если RuStore Pay срока не сообщил — трое суток с последней проверки. Приостановка,
 * закрытая и не бывшая подписка — нет.
 */
export function plusOpen(s: PlusState | null, now: number): boolean {
  if (!s || (s.status !== 'active' && s.status !== 'grace')) return false;
  return now <= (s.until ?? s.checkedAt + PLUS_OFFLINE_MS);
}

/**
 * Показать ли строку «Вся библиотека — в „Узоры+“» на «Готово»: только после бесплатной
 * картинки, не в первые три дня после установки и не второй раз за день.
 */
export function offerOnDone(o: { today: string; installed: string; shownOn?: string; free: boolean }): boolean {
  return o.free && daysBetween(o.installed, o.today) >= OFFER_AFTER_DAYS && o.shownOn !== o.today;
}

/** День следующего списания: через месяц (31 января → 28 или 29 февраля) или через год. */
export function nextCharge(today: string, period: PlusPeriod): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  const [ny, nm] = period === 'year' ? [y + 1, m] : m === 12 ? [y + 1, 1] : [y, m + 1];
  const first = `${ny}-${String(nm).padStart(2, '0')}-01`;
  // последний день месяца — если в нём нет такого числа
  let day = d;
  while (day > 28 && !isDate(`${first.slice(0, 8)}${String(day).padStart(2, '0')}`)) day--;
  return addDays(first, day - 1);
}
