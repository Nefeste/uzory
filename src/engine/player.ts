// Игрок на этом телефоне (docs/04-data-model.md, «Телефон»): что хранится и как запись из
// хранилища приводится в порядок. Хранит и отдаёт экранам src/state/player.tsx.
import { isDate, maxDate } from './dates';
import { type HintId, HINTS } from './hints';

export interface Player {
  /** день первого запуска — с него календарь картинок дня */
  installed: string;
  /** самая поздняя дата, какую видел телефон: часы назад ничего не запирают */
  seen: string;
  /**
   * Картинки дня, показанные по запасному правилу (за концом расписания): дата → id. Они не
   * меняются, даже если потом придёт набор с расписанием на эти дни (src/engine/calendar.ts).
   */
  pinned: Record<string, string>;
  /** первая картинка вышита — на главной с этих пор картинка дня */
  firstDone: boolean;
  /** сделанные подсказки (src/engine/hints.ts) */
  hints: HintId[];
  /** когда на «Готово» показывали строку «Узоры+» — не чаще раза в сутки (src/engine/plus.ts) */
  plusOfferShownOn?: string;
}

/** Запись из хранилища — в порядок: чужое и испорченное отбрасывается, не хватает — сегодня. */
export function normalizePlayer(raw: unknown, today: string): Player {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Player, unknown>>;
  const date = (x: unknown) => (typeof x === 'string' && isDate(x) ? x : undefined);
  const installed = date(r.installed) ?? today;
  const pinned: Record<string, string> = {};
  if (r.pinned && typeof r.pinned === 'object') {
    for (const [d, id] of Object.entries(r.pinned as Record<string, unknown>)) if (date(d) && typeof id === 'string') pinned[d] = id;
  }
  const hints = Array.isArray(r.hints) ? HINTS.filter((h) => (r.hints as unknown[]).includes(h)) : [];
  const offered = date(r.plusOfferShownOn);
  return {
    // часы перевели назад до первого запуска — календарь всё равно начинается с первого запуска
    installed,
    seen: maxDate(maxDate(date(r.seen) ?? today, today), installed),
    pinned,
    firstDone: r.firstDone === true,
    hints,
    ...(offered ? { plusOfferShownOn: offered } : {}),
  };
}
