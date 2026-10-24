// Слой магазина подписки «Узоры+» (docs/specs/2026-09-plus.md, «Протокол»): что игра спрашивает у
// RuStore Pay. Сам магазин — в ./billing.ts (телефон: RuStore Pay, src/money/) и ./billing.web.ts
// (веб-версия).
import type { PlusPeriod, PlusState } from '../engine/plus';

/** Товары в консоли RuStore — вечные, как идентификатор приложения. */
export type ProductId = 'uzory_plus_month' | 'uzory_plus_year';

export interface Product {
  id: ProductId;
  period: PlusPeriod;
  /** цена, как её пишет магазин, с валютой: «199 ₽» */
  price: string;
  /** цена в копейках — для «≈ 83 ₽ в месяц» у годовой; нет — этой строки нет */
  kopecks?: number;
}

/** Почему не вышло: нет RuStore, нет сети, платёж не прошёл; отказ игрока — тихо назад. */
export type BillingFail = 'no-store' | 'offline' | 'failed' | 'cancelled';

/**
 * Почему магазин не ответил: `fail` — что сказать игроку (`null` — причина не видна, тогда только «Не удалось
 * узнать цену»), `detail` — что ответил RuStore, как есть: строка «Ответ RuStore» на экране «Узоры+»; по ней
 * видно, дело в консоли RuStore или в сборке (так «Нарды» нашли причину на проверке 1.0.0, 23.10.2026).
 */
export interface Availability {
  fail: BillingFail | null;
  detail?: string;
}

export interface Billing {
  /** есть ли где купить: false — сборка не для RuStore или RuStore Pay ещё не подключён */
  available: boolean;
  /** цены из магазина; null — магазин не ответил */
  products(): Promise<Product[] | null>;
  purchase(id: ProductId): Promise<{ ok: true; state: PlusState } | { ok: false; fail: BillingFail; detail?: string }>;
  /** права сейчас — при запуске, на экране «Узоры+», по «Восстановить покупки»; null — не узнали */
  status(): Promise<PlusState | null>;
  /** Почему магазин не ответил — когда цен нет или права не узнать: нет или устарел RuStore, нет сети, что сказал RuStore. */
  availability(): Promise<Availability>;
}

/** Магазина нет: ни цен, ни покупок, ни прав — прежний ответ остаётся как есть. */
export const noBilling: Billing = {
  available: false,
  products: async () => null,
  purchase: async () => ({ ok: false, fail: 'no-store' }),
  status: async () => null,
  availability: async () => ({ fail: 'no-store' }),
};
