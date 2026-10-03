// Магазин подписки «Узоры+» (docs/specs/2026-09-plus.md, «Протокол»): цены, покупка и права —
// у RuStore Pay, только в сборке для RuStore. Он подключается после ИП и RuStore Pay на ИП (В2):
// код переносится из «Нард» по текущей документации SDK, а не по памяти (AGENTS.md). До этого
// магазина нет — экран «Узоры+» так и говорит, а всё бесплатное работает.
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

export interface Billing {
  /** есть ли где купить: false — сборка не для RuStore или RuStore Pay ещё не подключён */
  available: boolean;
  /** цены из магазина; null — магазин не ответил */
  products(): Promise<Product[] | null>;
  purchase(id: ProductId): Promise<{ ok: true; state: PlusState } | { ok: false; fail: BillingFail }>;
  /** права сейчас — при запуске, на экране «Узоры+», по «Восстановить покупки»; null — не узнали */
  status(): Promise<PlusState | null>;
}

/** Магазина нет: ни цен, ни покупок, ни прав — прежний ответ остаётся как есть. */
export const noBilling: Billing = {
  available: false,
  products: async () => null,
  purchase: async () => ({ ok: false, fail: 'no-store' }),
  status: async () => null,
};

export const billing: Billing = noBilling;
