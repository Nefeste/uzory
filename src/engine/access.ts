// Что доступно игроку — одна чистая функция (docs/04-data-model.md, «Что доступно игроку»;
// правила — docs/08-game-design.md, «„Узоры+“ глазами игрока»).
import { maxDate } from './dates';
import { FREE_FIRST, type Picture } from './library';

export type Access = 'free' | 'daily' | 'started' | 'plus' | 'locked';

export interface AccessContext {
  /** дата телефона, «2026-10-05» */
  today: string;
  /** самая поздняя дата, какую видел телефон: часы назад ничего не запирают */
  seen: string;
  /** дата первого запуска — начало календаря игрока */
  installed: string;
  /** когда картинка была картинкой дня */
  dailyFrom: (id: string) => string | undefined;
  /** действует ли подписка */
  plus: boolean;
  /** есть ли работа по этой картинке */
  hasWork: (id: string) => boolean;
}

export function access(p: Picture, ctx: AccessContext): Access {
  if (p.free || p.order < FREE_FIRST) return 'free';
  const day = ctx.dailyFrom(p.id);
  if (day !== undefined && day >= ctx.installed && day <= maxDate(ctx.today, ctx.seen)) return 'daily';
  if (ctx.hasWork(p.id)) return 'started';
  if (ctx.plus) return 'plus';
  return 'locked';
}

/** Можно ли вышивать: всё, кроме запертого. */
export const canStitch = (a: Access) => a !== 'locked';
