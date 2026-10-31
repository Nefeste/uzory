// из nardy: tools/test/money.test.ts @ 63e8ee9 и af8b683 (раздел «Е2»: ответы RuStore Pay и плагин сборки)
// RuStore Pay «Узоров+» (docs/specs/2026-09-plus.md, «Протокол»): ответы RuStore → права, цены и
// причины; магазин на поддельном нативном модуле — без номера приложения покупок нет; плагин
// сборки из общего набора `@gornitsa/kit` подключён с настройками «Узоров» и без номера ничего не
// вписывает. Вставки плагина в шаблоны Expo и типы обёртки проверяют тесты набора.
import { describe, expect, test } from 'bun:test';
import { PLUS_OFFLINE_MS, plusOpen } from '../../src/engine/plus';
import type { PayNative, RsProduct, RsPurchase } from '../../src/money/rustore';
import { rustoreBilling } from '../../src/money/rustoreBilling';
import { causeOf, failOf, kopecksOf, plusStateOf, productsOf, rsDetail, rsText, unavailableOf } from '../../src/money/rustoreRules';
import { buy } from '@gornitsa/kit/rustore-pay/rules';

const DAY = 86400000;
const NOW = Date.parse('2026-10-20T12:00:00Z');
const APP_ID = '2063773260';

const sub = (productId: string, status: string, expirationDate: string): RsPurchase =>
  ({ subscriptionPurchase: { purchaseId: `p-${productId}-${status}`, productId, status, expirationDate, gracePeriodEnabled: false, sandbox: true } });
const product = (productId: string, amountLabel: string): RsProduct =>
  ({ productId, type: 'SUBSCRIPTION', amountLabel, currency: 'RUB', title: productId });
const err = (code: string) => Object.assign(new Error(code), { code });

describe('ответы RuStore Pay → права «Узоров+»', () => {
  const until = '2026-11-20T12:00:00+03:00';

  test('подписки нет — «не было», с временем проверки', () => {
    expect(plusStateOf([], NOW)).toEqual({ status: 'none', checkedAt: NOW });
  });

  test('ACTIVE — действует до expirationDate; PAUSED — приостановка; CLOSED — закрыта', () => {
    expect(plusStateOf([sub('uzory_plus_month', 'ACTIVE', until)], NOW)).toEqual({ status: 'active', product: 'month', until: Date.parse(until), checkedAt: NOW });
    expect(plusStateOf([sub('uzory_plus_year', 'PAUSED', until)], NOW)).toEqual({ status: 'hold', product: 'year', until: Date.parse(until), checkedAt: NOW });
    expect(plusStateOf([sub('uzory_plus_year', 'CLOSED', until)], NOW).status).toBe('closed');
    expect(plusOpen(plusStateOf([sub('uzory_plus_month', 'ACTIVE', until)], NOW), NOW)).toBe(true);
    expect(plusOpen(plusStateOf([sub('uzory_plus_year', 'PAUSED', until)], NOW), NOW)).toBe(false);
  });

  test('счёт не оплачен, незнакомый статус, чужой товар, разовая покупка — прав нет', () => {
    for (const list of [
      [sub('uzory_plus_month', 'INVOICE_CREATED', until)],
      [sub('uzory_plus_month', 'КАК-ТО ЕЩЁ', until)],
      [sub('pro_month', 'ACTIVE', until)],
      [{ productPurchase: { purchaseId: 'q', productId: 'uzory_plus_month', status: 'CONFIRMED', productType: 'NON_CONSUMABLE_PRODUCT' as const, sandbox: true } }],
    ]) expect(plusStateOf(list, NOW)).toEqual({ status: 'none', checkedAt: NOW });
  });

  test('«действует», а дата прошла или не разобралась — без срока: трое суток с проверки', () => {
    for (const date of ['2026-10-19T12:00:00Z', 'когда-нибудь']) {
      const s = plusStateOf([sub('uzory_plus_month', 'ACTIVE', date)], NOW);
      expect(s).toEqual({ status: 'active', product: 'month', checkedAt: NOW });
      expect(plusOpen(s, NOW + PLUS_OFFLINE_MS)).toBe(true);
      expect(plusOpen(s, NOW + PLUS_OFFLINE_MS + 1)).toBe(false);
    }
  });

  test('несколько подписок: действующая важнее, из действующих — с дальней датой; порядок не важен', () => {
    const year = '2027-10-20T12:00:00Z';
    const list = [sub('uzory_plus_month', 'CLOSED', '2026-09-20T12:00:00Z'), sub('uzory_plus_month', 'ACTIVE', until), sub('uzory_plus_year', 'ACTIVE', year), sub('uzory_plus_year', 'PAUSED', '2028-01-01T00:00:00Z')];
    for (const l of [list, [...list].reverse()]) expect(plusStateOf(l, NOW)).toEqual({ status: 'active', product: 'year', until: Date.parse(year), checkedAt: NOW });
  });
});

describe('цены и ошибки RuStore', () => {
  test('цена строкой → копейки для «≈ 83 ₽ в месяц»; не рубли и не разобралось — нет', () => {
    expect(kopecksOf('990 ₽')).toBe(99000);
    expect(kopecksOf('1 490 ₽')).toBe(149000);
    expect(kopecksOf('1 490,00 ₽')).toBe(149000);
    expect(kopecksOf('199.5 ₽')).toBe(19950);
    expect(kopecksOf('990 руб.')).toBe(99000);
    expect(kopecksOf('$9.99')).toBeUndefined();
    expect(kopecksOf('бесплатно ₽')).toBeUndefined();
    expect(kopecksOf('1.490.000 ₽')).toBeUndefined();
  });

  test('товары: только наши подписки с ценой, месяц, затем год', () => {
    const list = [product('uzory_plus_year', '990 ₽'), product('pro_month', '199 ₽'), product('uzory_plus_month', '199 ₽')];
    expect(productsOf(list)).toEqual([
      { id: 'uzory_plus_month', period: 'month', price: '199 ₽', kopecks: 19900 },
      { id: 'uzory_plus_year', period: 'year', price: '990 ₽', kopecks: 99000 },
    ]);
    expect(productsOf([product('uzory_plus_month', ' '), product('uzory_plus_year', 'USD 9')])).toEqual([{ id: 'uzory_plus_year', period: 'year', price: 'USD 9' }]);
  });

  test('ошибка → что сказать: отказ и отказ войти — тихо; нет RuStore; нет сети; прочее — платёж не прошёл', async () => {
    // покупка — `buy` набора: он ловит отказ обёртки и отдаёт код и причину
    const failed = async (e: unknown) => {
      const r = await buy({ purchase: async () => { throw e; } }, 'uzory_plus_month', 'LIGHT');
      if (r.ok) throw new Error('покупка прошла');
      return failOf(r);
    };
    expect(await failed(err('ProductPurchaseCancelled'))).toBe('cancelled');
    expect(await failed(err('RuStoreUserUnauthorizedException'))).toBe('cancelled');
    expect(await failed(err('RuStoreNotInstalledException'))).toBe('no-store');
    expect(await failed(err('RuStoreOutdatedException'))).toBe('no-store');
    expect(await failed(err('RuStorePaymentNetworkException'))).toBe('offline');
    expect(await failed(err('ProductPurchaseException'))).toBe('failed');
    // причины набора, у которых в «Узорах» своих слов нет, — «платёж не прошёл»
    expect(await failed(err('RuStorePayInvalidConsoleAppId'))).toBe('failed');
    expect(await failed(err('ApplicationSchemeWasNotProvided'))).toBe('failed');
    expect(await failed(new Error('сеть'))).toBe('failed');
    expect(await failed(null)).toBe('failed');
  });

  test('магазин недоступен: по коду — нет RuStore и нет сети, прочие причины набора не видны игроку', () => {
    expect(unavailableOf(err('RuStoreNotInstalledException'))).toBe('no-store');
    expect(unavailableOf(err('RuStoreOutdatedException'))).toBe('no-store');
    expect(unavailableOf(err('RuStorePaymentNetworkException'))).toBe('offline');
    for (const code of ['RuStoreUserUnauthorizedException', 'RuStorePayInvalidConsoleAppId', 'ApplicationSchemeWasNotProvided', 'RuStorePaymentCommonException']) {
      expect({ code, fail: unavailableOf(err(code)) }).toEqual({ code, fail: null });
    }
    expect(unavailableOf(new Error('сеть'))).toBeNull();
    expect(unavailableOf(null)).toBeNull();
  });

  test('«Ответ RuStore»: знакомые тексты SDK — в причину; строка — в одну, не длиннее 200 знаков; код и текст ошибки', () => {
    // тексты — как в Pay SDK 11.1.0 и core 10.5.0 (разбор «Нард», 23.10.2026)
    expect(causeOf('ru.rustore.sdk.core.exception.RuStoreNotInstalledException: RuStore not installed')).toBe('no-store');
    expect(causeOf('RuStore outdated')).toBe('no-store');
    expect(causeOf('Application signature not correct')).toBeNull();
    expect(causeOf('Console application id is not provided')).toBeNull();
    expect(causeOf('RuStore User Not Authorized')).toBeNull();
    expect(causeOf('Application scheme was not provided')).toBeNull();
    expect(rsText('  Application\n signature   not correct ')).toBe('Application signature not correct');
    expect(rsText('а'.repeat(300))).toHaveLength(200);
    expect(rsText('   ')).toBeUndefined();
    expect(rsText(undefined)).toBeUndefined();
    expect(rsDetail(err('RuStorePaySignatureException'))).toBe('RuStorePaySignatureException: RuStorePaySignatureException');
    expect(rsDetail(Object.assign(new Error('Application signature not correct'), { code: 'RuStorePaymentCommonException' })))
      .toBe('RuStorePaymentCommonException: Application signature not correct');
    expect(rsDetail(new Error('сеть'))).toBe('сеть');
    expect(rsDetail(null)).toBeUndefined();
  });
});

/** Поддельный нативный модуль: записывает вызовы, отвечает по заданному. */
function fakePay(o: { purchases?: () => RsPurchase[]; buy?: () => void; products?: RsProduct[]; available?: boolean; cause?: string; installed?: boolean } = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const rec = (name: string, args: unknown[]) => calls.push({ name, args });
  // у настоящего модуля метод отметки «выдано» есть, и вызов с неверным числом аргументов бросает
  // исключение сразу (новая архитектура React Native) — покупка не должна его трогать
  const pay: PayNative & { updateAcknowledgementState: (...a: unknown[]) => never } = {
    getPurchaseAvailability: async () => (rec('getPurchaseAvailability', []), { availability: o.available ?? true, ...(o.cause ? { cause: o.cause } : {}) }),
    getProducts: async (ids) => (rec('getProducts', [ids]), o.products ?? []),
    getPurchases: async (...a) => (rec('getPurchases', a), (o.purchases ?? (() => []))()),
    getPurchase: async (id) => (rec('getPurchase', [id]), {}),
    purchase: async (...a) => {
      rec('purchase', a);
      o.buy?.();
      return { purchaseId: 'buy-1', productId: String(a[0]), invoiceId: 'inv', productType: 'SUBSCRIPTION', sandbox: true };
    },
    updateAcknowledgementState: (...a) => {
      rec('updateAcknowledgementState', a);
      throw new Error('TurboModule method "updateAcknowledgementState" called with 2 arguments (expected argument count: 3)');
    },
    getUserAuthorizationStatus: async () => true,
    isRuStoreInstalled: async () => o.installed ?? true,
    openRuStore: async () => undefined,
    openRuStoreAuthorization: async () => undefined,
  };
  return { pay, calls };
}

describe('магазин RuStore Pay (src/money/rustoreBilling.ts)', () => {
  test('без номера приложения или без нативного модуля покупок нет — и RuStore не спрашивают', async () => {
    const { pay, calls } = fakePay({ products: [product('uzory_plus_month', '199 ₽')] });
    for (const b of [rustoreBilling(pay, ''), rustoreBilling(pay, '   '), rustoreBilling(null, APP_ID), rustoreBilling(null, '')]) {
      expect(b.available).toBe(false);
      expect(await b.products()).toBeNull();
      expect(await b.status()).toBeNull();
      expect(await b.purchase('uzory_plus_year')).toEqual({ ok: false, fail: 'no-store' });
      expect(await b.availability()).toEqual({ fail: 'no-store' });
    }
    expect(calls).toEqual([]);
  });

  test('с номером: цены из RuStore; ничего не пришло или ошибка — «цену не узнать»', async () => {
    const ok = rustoreBilling(fakePay({ products: [product('uzory_plus_year', '990 ₽'), product('uzory_plus_month', '199 ₽')] }).pay, APP_ID, () => NOW);
    expect(ok.available).toBe(true);
    expect((await ok.products())?.map((p) => `${p.period} ${p.price}`)).toEqual(['month 199 ₽', 'year 990 ₽']);
    expect(await rustoreBilling(fakePay().pay, APP_ID).products()).toBeNull();
    const broken = fakePay();
    broken.pay.getProducts = async () => { throw err('RuStorePaymentNetworkException'); };
    expect(await rustoreBilling(broken.pay, APP_ID).products()).toBeNull();
  });

  test('покупка: одна стадия, без почты и идентификатора игрока; срок — из списка покупок; без отметки «выдано»', async () => {
    let bought = false;
    const year = '2027-10-20T12:00:00Z';
    const f = fakePay({ buy: () => { bought = true; }, purchases: () => (bought ? [sub('uzory_plus_year', 'ACTIVE', year)] : []) });
    const r = await rustoreBilling(f.pay, APP_ID, () => NOW).purchase('uzory_plus_year');
    expect(r).toEqual({ ok: true, state: { status: 'active', product: 'year', until: Date.parse(year), checkedAt: NOW } });
    const call = f.calls.find((c) => c.name === 'purchase')!;
    expect(call.args[0]).toBe('uzory_plus_year');
    expect(call.args[4]).toBeNull(); // appUserId
    expect(call.args[5]).toBeNull(); // appUserEmail
    expect(call.args[6]).toBe('ONE_STEP');
    expect(call.args[7]).toBe('LIGHT'); // тема шторки — светлая, как игра
    expect(call.args).toHaveLength(9); // ровно столько, сколько у метода обёртки 11.1.0
    // «Нарды» 1.1.0 и 1.1.2: отметка ломала оплату и роняла приложение — её нет совсем
    expect(f.calls.find((c) => c.name === 'updateAcknowledgementState')).toBeUndefined();
  });

  test('оплачено, а в списке покупок её ещё нет — открыто без срока (трое суток до следующей проверки)', async () => {
    const r = await rustoreBilling(fakePay().pay, APP_ID, () => NOW).purchase('uzory_plus_month');
    expect(r).toEqual({ ok: true, state: { status: 'active', product: 'month', checkedAt: NOW } });
  });

  test('отказ, сбой, нет сети — причина; но если RuStore говорит, что подписка есть, — она есть', async () => {
    const failing = (code: string, purchases: RsPurchase[] = []) => {
      const f = fakePay({ purchases: () => purchases });
      f.pay.purchase = async () => { throw err(code); };
      return rustoreBilling(f.pay, APP_ID, () => NOW);
    };
    // отказ игрока — тихо, без строки; остальное — с ответом RuStore
    expect(await failing('ProductPurchaseCancelled').purchase('uzory_plus_year')).toEqual({ ok: false, fail: 'cancelled' });
    expect(await failing('ProductPurchaseException').purchase('uzory_plus_year'))
      .toEqual({ ok: false, fail: 'failed', detail: 'ProductPurchaseException: ProductPurchaseException' });
    expect(await failing('RuStorePaymentNetworkException').purchase('uzory_plus_year'))
      .toEqual({ ok: false, fail: 'offline', detail: 'RuStorePaymentNetworkException: RuStorePaymentNetworkException' });
    expect(await failing('RuStoreNotInstalledException').purchase('uzory_plus_year'))
      .toEqual({ ok: false, fail: 'no-store', detail: 'RuStoreNotInstalledException: RuStoreNotInstalledException' });
    const paid = await failing('ProductPurchaseCancelled', [sub('uzory_plus_month', 'ACTIVE', '2026-11-20T12:00:00Z')]).purchase('uzory_plus_month');
    expect(paid.ok && paid.state.status).toBe('active');
  });

  test('права: список покупок → состояние; RuStore не ответил — null, прежний ответ остаётся', async () => {
    const f = fakePay({ purchases: () => [sub('uzory_plus_month', 'PAUSED', '2026-11-20T12:00:00Z')] });
    expect((await rustoreBilling(f.pay, APP_ID, () => NOW).status())?.status).toBe('hold');
    expect(f.calls.find((c) => c.name === 'getPurchases')?.args).toEqual([null, null, null]);
    const broken = fakePay({ purchases: () => { throw err('RuStorePaymentNetworkException'); } });
    expect(await rustoreBilling(broken.pay, APP_ID).status()).toBeNull();
  });

  test('почему цен нет: RuStore не установлен — «установите RuStore»; иначе причина не видна; ответ RuStore — как есть', async () => {
    const at = (o: Parameters<typeof fakePay>[0]) => rustoreBilling(fakePay(o).pay, APP_ID).availability();
    expect(await at({})).toEqual({ fail: null });
    expect(await at({ available: false, installed: false })).toEqual({ fail: 'no-store' });
    expect(await at({ available: false })).toEqual({ fail: null });
    // любая ошибка SDK по дороге приходит ответом «недоступно» — только текстом (разбор «Нард», 23.10.2026)
    expect(await at({ available: false, cause: 'Application signature not correct' }))
      .toEqual({ fail: null, detail: 'Application signature not correct' });
    expect(await at({ available: false, cause: 'RuStore outdated' })).toEqual({ fail: 'no-store', detail: 'RuStore outdated' });
    expect(await at({ available: false, cause: 'Что-то новое', installed: false })).toEqual({ fail: 'no-store', detail: 'Что-то новое' });
    const thrown = (code: string) => {
      const f = fakePay();
      f.pay.getPurchaseAvailability = async () => { throw err(code); };
      return rustoreBilling(f.pay, APP_ID).availability();
    };
    expect(await thrown('RuStoreOutdatedException')).toEqual({ fail: 'no-store', detail: 'RuStoreOutdatedException: RuStoreOutdatedException' });
    expect(await thrown('RuStorePaymentNetworkException')).toEqual({ fail: 'offline', detail: 'RuStorePaymentNetworkException: RuStorePaymentNetworkException' });
    expect(await thrown('RuStorePaymentCommonException')).toEqual({ fail: null, detail: 'RuStorePaymentCommonException: RuStorePaymentCommonException' });
  });
});

describe('плагин сборки из набора (@gornitsa/kit/rustore-pay/plugin)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { plan } = require('@gornitsa/kit/rustore-pay/plugin') as {
    plan: (env: Record<string, string | undefined>, o: object) => { appId: string; mods: string[] };
  };
  const root = `${import.meta.dir}/../..`;
  const entry = async () => {
    const app = JSON.parse(await Bun.file(`${root}/app.json`).text());
    return (app.expo.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === '@gornitsa/kit/rustore-pay/plugin') as [string, object] | undefined;
  };

  test('подключён в app.json со схемой «Узоров» (вечной: она в манифесте выпущенных сборок) и без номера — ничего', async () => {
    // gornitsauzorypay — прежняя SCHEME из plugins/with-rustore.js; другой сборки, кроме RuStore, нет
    expect((await entry())?.[1]).toEqual({ scheme: 'gornitsauzorypay', noAppId: 'skip' });
    const app = JSON.parse(await Bun.file(`${root}/app.json`).text());
    expect(app.expo.plugins).not.toContain('./plugins/with-rustore');
  });

  test('без RUSTORE_APP_ID плагин ничего не вписывает — сборка та же, что до RuStore Pay', async () => {
    const o = (await entry())![1];
    expect(plan({}, o).mods).toEqual([]);
    expect(plan({ EXPO_PUBLIC_RUSTORE_APP_ID: ' ' }, o).mods).toEqual([]);
    expect(plan({ EXPO_PUBLIC_RUSTORE_APP_ID: APP_ID }, o)).toEqual({
      appId: APP_ID, mods: ['projectBuildGradle', 'appBuildGradle', 'mainApplication', 'mainActivity', 'manifest'],
    });
  });

  test('номер приложения в репозиторий не зашит', async () => {
    const wf = await Bun.file(`${root}/.github/workflows/android.yml`).text();
    expect(wf).toContain("EXPO_PUBLIC_RUSTORE_APP_ID: ${{ vars.RUSTORE_APP_ID || '' }}");
    for (const f of ['app.json', '.github/workflows/android.yml', 'src/state/billing.ts']) {
      expect({ f, hasId: (await Bun.file(`${root}/${f}`).text()).includes(APP_ID) }).toEqual({ f, hasId: false });
    }
  });
});
