// из nardy: src/money/billing.ts @ 63e8ee9 (порт «Узоров» — src/state/billingApi.ts, права — PlusState)
// Магазин подписки «Узоры+» на телефоне — RuStore Pay (docs/specs/2026-09-plus.md, «Протокол»).
// Фабрика, а не модуль: нативный модуль и номер приложения приходят аргументами, поэтому
// tools/test/rustore.test.ts проверяет её под Bun с поддельным модулем. Собирает её
// src/state/billing.ts.
//
// Без номера приложения в консоли RuStore (`RUSTORE_APP_ID` → `EXPO_PUBLIC_RUSTORE_APP_ID`) или без
// нативного модуля (Expo Go) магазина нет — как до RuStore Pay: SDK оплаты без номера не работает,
// а спрашивать его зря — значит показывать игроку ошибку RuStore. Почту и идентификатор игрока
// (`appUserEmail`, `appUserId`) игра в RuStore Pay не передаёт (docs/10-money.md, «RuStore»).
import { plusOpen, type PlusState } from '../engine/plus';
import type { Billing, BillingFail } from '../state/billingApi';
import type { PayNative } from './rustore';
import { failOf, PLUS_PRODUCTS, PRODUCT_IDS, plusStateOf, productsOf, rsCode } from './rustoreRules';

export function rustoreBilling(pay: PayNative | null, appId: string, now: () => number = Date.now): Billing {
  if (!pay || !appId.trim()) {
    return {
      available: false,
      products: async () => null,
      purchase: async () => ({ ok: false, fail: 'no-store' }),
      status: async () => null,
      availability: async () => 'no-store',
    };
  }

  const status = async (): Promise<PlusState | null> => {
    try {
      return plusStateOf(await pay.getPurchases(null, null, null), now());
    } catch {
      return null;
    }
  };

  return {
    available: true,
    async products() {
      try {
        const list = productsOf(await pay.getProducts([...PRODUCT_IDS]));
        return list.length ? list : null;
      } catch {
        return null;
      }
    },
    async purchase(id) {
      try {
        // одна стадия: выдавать подписку нечем, кроме самого приложения (как «Про» в «Нардах»)
        const r = await pay.purchase(id, null, null, null, null, null, 'ONE_STEP', 'LIGHT', {});
        // подписка выдана — отметить в RuStore (для оплаты не обязательно; не вышло — не страшно)
        pay.updateAcknowledgementState(r.purchaseId, 'ACKNOWLEDGED').catch(() => undefined);
        // срок — из списка покупок; RuStore его ещё не отдал — оплачено, срока нет: трое суток
        // с проверки (src/engine/plus.ts), а следующая проверка его узнает
        const s = await status();
        return { ok: true, state: s && plusOpen(s, now()) ? s : { status: 'active', product: PLUS_PRODUCTS[id], checkedAt: now() } };
      } catch (e) {
        const fail = failOf(e);
        // игрок мог заплатить и закрыть окно, или ответ потерялся: права — у RuStore (spec,
        // «Неудачные случаи»), поэтому после любого отказа, кроме «нет RuStore», — спросить его
        if (fail !== 'no-store') {
          const s = await status();
          if (s && plusOpen(s, now())) return { ok: true, state: s };
        }
        return { ok: false, fail };
      }
    },
    status,
    async availability(): Promise<BillingFail | null> {
      try {
        const a = await pay.getPurchaseAvailability();
        if (a.availability) return null;
        // причина приходит строкой SDK; нет RuStore — видно отдельным методом
        return (await pay.isRuStoreInstalled().catch(() => true)) ? null : 'no-store';
      } catch (e) {
        const code = rsCode(e);
        return code === 'RuStoreNotInstalledException' || code === 'RuStoreOutdatedException' ? 'no-store'
          : code === 'RuStorePaymentNetworkException' ? 'offline' : null;
      }
    },
  };
}
