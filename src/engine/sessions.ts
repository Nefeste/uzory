// Запуски и сбои на этом телефоне (docs/specs/2026-09-v1.md, «Ворота выпуска 1.0»: сессий без
// сбоев ≥ 99,5 %). Игра на экране — сессия открыта; ушла в фон или закрылась — закрыта. Если
// к следующему запуску сессия всё ещё открыта, прошлый раз игра оборвалась: упала, в том числе
// так, что журнал сбоев этого не увидел (Skia, Hermes). Счёт живёт только на телефоне и попадает
// лишь в отчёт об ошибке, который игрок видит целиком и отправляет сам.
import { isDate } from './dates';

export interface Sessions {
  /** с какого дня считаем */
  since: string;
  /** сколько раз игру открывали или возвращались в неё */
  starts: number;
  /** сколько сессий оборвались, не уйдя в фон */
  unclean: number;
  /** игра сейчас на экране */
  open: boolean;
}

const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);

/** Запись из хранилища — в порядок; чужое и испорченное — счёт с сегодняшнего дня. */
export function normalizeSessions(raw: unknown, today: string): Sessions {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const since = typeof r.since === 'string' && isDate(r.since) ? r.since : today;
  const starts = count(r.starts);
  return { since, starts, unclean: Math.min(count(r.unclean), starts), open: r.open === true };
}

/** Игра на экране: запуск или возвращение. Прошлая сессия не закрылась — она оборвалась. */
export function sessionStart(s: Sessions): Sessions {
  return { ...s, starts: s.starts + 1, unclean: s.unclean + (s.open ? 1 : 0), open: true };
}

/** Игра ушла в фон или закрылась как положено. */
export function sessionEnd(s: Sessions): Sessions {
  return s.open ? { ...s, open: false } : s;
}

/** Законченные сессии (без идущей сейчас) и сколько из них оборвались. */
export function sessionTotals(s: Sessions): { done: number; unclean: number } {
  return { done: Math.max(0, s.starts - (s.open ? 1 : 0)), unclean: s.unclean };
}
