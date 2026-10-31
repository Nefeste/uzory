// из nardy: src/money/billing.ts @ 63e8ee9, «Ответ RuStore» — @ af8b683 (порт «Узоров» — src/state/billingApi.ts, права — PlusState);
// сама покупка — `buy` общего набора `@gornitsa/kit/rustore-pay` (тег v1.1.0)
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
import type { Availability, Billing } from '../state/billingApi';
import { buy } from '@gornitsa/kit/rustore-pay/rules';
import type { PayNative } from './rustore';
import { LOOK_PRODUCTS } from '../engine/looks';
import { causeOf, failOf, lookPricesOf, looksOf, PLUS_PRODUCTS, PRODUCT_IDS, plusStateOf, productsOf, rsDetail, rsText, unavailableOf } from './rustoreRules';

export function rustoreBilling(pay: PayNative | null, appId: string, now: () => number = Date.now): Billing {
  if (!pay || !appId.trim()) {
    return {
      available: false,
      products: async () => null,
      purchase: async () => ({ ok: false, fail: 'no-store' }),
      status: async () => null,
      availability: async () => ({ fail: 'no-store' }),
      lookPrices: async () => null,
      buyLook: async () => ({ ok: false, fail: 'no-store' }),
      looks: async () => null,
    };
  }

  /** Купленные оформления — из того же списка покупок, что и подписка; не узнали — null. */
  const looks = async (): Promise<string[] | null> => {
    try {
      return looksOf(await pay.getPurchases(null, null, null));
    } catch {
      return null;
    }
  };

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
      // одна стадия, без почты и идентификатора игрока — `buy` набора (как «Про» в «Нардах»): выдавать
      // подписку нечем, кроме самого приложения. Отметки «выдано» (`updateAcknowledgementState`) нет:
      // она необязательна (RuStore, «Признак выдачи товара»), а в обёртке 11.1.0 ломает оплату — с
      // двумя аргументами модуль бросает исключение сразу, с тремя её ответ роняет приложение
      // («Нарды» 1.1.0, 1.1.2).
      const r = await buy(pay, id, 'LIGHT');
      if (r.ok) {
        // срок — из списка покупок; RuStore его ещё не отдал — оплачено, срока нет: трое суток
        // с проверки (src/engine/plus.ts), а следующая проверка его узнает
        const s = await status();
        return { ok: true, state: s && plusOpen(s, now()) ? s : { status: 'active', product: PLUS_PRODUCTS[id], checkedAt: now() } };
      }
      const fail = failOf(r);
      // игрок мог заплатить и закрыть окно, или ответ потерялся: права — у RuStore (spec,
      // «Неудачные случаи»), поэтому после любого отказа, кроме «нет RuStore», — спросить его
      if (fail !== 'no-store') {
        const s = await status();
        if (s && plusOpen(s, now())) return { ok: true, state: s };
      }
      // отказ игрока — тихо; остальное — что ответил RuStore, строкой на экране
      return fail === 'cancelled' ? { ok: false, fail } : { ok: false, fail, detail: r.detail };
    },
    status,
    async availability(): Promise<Availability> {
      try {
        const a = await pay.getPurchaseAvailability();
        if (a.availability) return { fail: null };
        // любая ошибка SDK по дороге приходит сюда же, только текстом (rustoreRules.ts, causeOf);
        // он и идёт игроку строкой «Ответ RuStore»
        const detail = rsText(a.cause);
        const known = detail ? causeOf(detail) : null;
        if (known) return { fail: known, detail };
        // нет RuStore — видно и отдельным методом
        const installed = await pay.isRuStoreInstalled().catch(() => true);
        return { fail: installed ? null : 'no-store', detail };
      } catch (e) {
        return { fail: unavailableOf(e), detail: rsDetail(e) };
      }
    },
    async lookPrices() {
      try {
        const list = lookPricesOf(await pay.getProducts([...LOOK_PRODUCTS]));
        return list.length ? list : null;
      } catch {
        return null;
      }
    },
    async buyLook(id) {
      // как подписка: одна стадия, без почты и идентификатора игрока, без отметки «выдано»
      const r = await buy(pay, id, 'LIGHT');
      if (r.ok) {
        // оплачено, а в списке покупок её ещё нет — она уже есть: RuStore просто не успел
        const owned = (await looks()) ?? [];
        return { ok: true, owned: owned.includes(id) ? owned : [...owned, id] };
      }
      const fail = failOf(r);
      // игрок мог заплатить и закрыть окно, или ответ потерялся: права — у RuStore
      if (fail !== 'no-store') {
        const owned = await looks();
        if (owned?.includes(id)) return { ok: true, owned };
      }
      return fail === 'cancelled' ? { ok: false, fail } : { ok: false, fail, detail: r.detail };
    },
    looks,
  };
}
