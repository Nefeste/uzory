// из nardy: tools/test/money.test.ts @ 63e8ee9 и af8b683 (раздел «Е2»: ответы RuStore Pay и плагин сборки)
// RuStore Pay «Узоров+» (docs/specs/2026-09-plus.md, «Протокол»): ответы RuStore → права, цены и
// причины; магазин на поддельном нативном модуле — без номера приложения покупок нет; плагин
// сборки встаёт в шаблоны Expo SDK 57 и без номера ничего не вписывает.
import { describe, expect, test } from 'bun:test';
import { PLUS_OFFLINE_MS, plusOpen } from '../../src/engine/plus';
import type { PayNative, RsProduct, RsPurchase } from '../../src/money/rustore';
import { rustoreBilling } from '../../src/money/rustoreBilling';
import { causeOf, failOf, kopecksOf, plusStateOf, productsOf, rsDetail, rsText } from '../../src/money/rustoreRules';

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

  test('ошибка → что сказать: отказ и отказ войти — тихо; нет RuStore; нет сети; прочее — платёж не прошёл', () => {
    expect(failOf(err('ProductPurchaseCancelled'))).toBe('cancelled');
    expect(failOf(err('RuStoreUserUnauthorizedException'))).toBe('cancelled');
    expect(failOf(err('RuStoreNotInstalledException'))).toBe('no-store');
    expect(failOf(err('RuStoreOutdatedException'))).toBe('no-store');
    expect(failOf(err('RuStorePaymentNetworkException'))).toBe('offline');
    expect(failOf(err('ProductPurchaseException'))).toBe('failed');
    expect(failOf(new Error('сеть'))).toBe('failed');
    expect(failOf(null)).toBe('failed');
  });

  test('«Ответ RuStore»: знакомые тексты SDK — в причину; строка — в одну, не длиннее 200 знаков; код и текст ошибки', () => {
    // тексты — как в Pay SDK 11.1.0 и core 10.5.0 (разбор «Нард», 23.10.2026)
    expect(causeOf('ru.rustore.sdk.core.exception.RuStoreNotInstalledException: RuStore not installed')).toBe('no-store');
    expect(causeOf('RuStore outdated')).toBe('no-store');
    expect(causeOf('Application signature not correct')).toBeNull();
    expect(causeOf('Console application id is not provided')).toBeNull();
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
  const pay: PayNative = {
    getPurchaseAvailability: async () => (rec('getPurchaseAvailability', []), { availability: o.available ?? true, ...(o.cause ? { cause: o.cause } : {}) }),
    getProducts: async (ids) => (rec('getProducts', [ids]), o.products ?? []),
    getPurchases: async (...a) => (rec('getPurchases', a), (o.purchases ?? (() => []))()),
    getPurchase: async (id) => (rec('getPurchase', [id]), {}),
    purchase: async (...a) => {
      rec('purchase', a);
      o.buy?.();
      return { purchaseId: 'buy-1', productId: String(a[0]), invoiceId: 'inv', productType: 'SUBSCRIPTION', sandbox: true };
    },
    updateAcknowledgementState: async (...a) => (rec('updateAcknowledgementState', a), 'ok'),
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

  test('покупка: одна стадия, без почты и идентификатора игрока; срок — из списка покупок; отметка «выдано»', async () => {
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
    expect(f.calls.find((c) => c.name === 'updateAcknowledgementState')?.args).toEqual(['buy-1', 'ACKNOWLEDGED']);
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

describe('плагин сборки plugins/with-rustore.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const plugin = require('../../plugins/with-rustore.js') as ((c: object) => { mods?: { android?: Record<string, unknown> } }) & {
    SCHEME: string;
    transforms: Record<'projectGradle' | 'appGradle' | 'mainApplication' | 'mainActivity', (s: string) => string> & { manifest: (m: object, id: string) => any };
  };

  test('вставки встают в шаблоны Expo SDK 57 и не повторяются', () => {
    const t = plugin.transforms;
    const project = 'allprojects {\n  repositories {\n    google()\n  }\n}\n';
    const app = 'android {\n}\n\ndependencies {\n    implementation("com.facebook.react:react-android")\n}\n';
    const application = 'package games.gornitsa.uzory\n\nimport android.app.Application\nimport com.facebook.react.PackageList\n\n' +
      '      packageList =\n        PackageList(this).packages.apply {\n          // add(MyReactNativePackage())\n        }\n';
    const activity = 'package games.gornitsa.uzory\n\nimport android.os.Build\nimport android.os.Bundle\n\nclass MainActivity : ReactActivity() {\n' +
      '  override fun onCreate(savedInstanceState: Bundle?) {\n    setTheme(R.style.AppTheme);\n    super.onCreate(null)\n  }\n}\n';
    for (const [f, src, mark] of [
      [t.projectGradle, project, 'nexus-external.rustore.ru'],
      [t.appGradle, app, 'ru.rustore.sdk-wrapper.react-native:pay:'],
      [t.mainApplication, application, 'add(RuStoreReactPayPackage())'],
      [t.mainActivity, activity, 'override fun onNewIntent(intent: Intent)'],
    ] as const) {
      const once = f(src);
      expect(once).toContain(mark);
      expect(f(once)).toBe(once);
    }
    expect(() => t.mainActivity('class MainActivity {}')).toThrow(/шаблон/);
  });

  test('манифест: номер приложения, схема возврата из банка — своя, у главного экрана', () => {
    const m = {
      manifest: {
        application: [{ $: { 'android:name': '.MainApplication' }, activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }] }] }],
      },
    };
    const out = plugin.transforms.manifest(m, APP_ID);
    const meta = Object.fromEntries(out.manifest.application[0]['meta-data'].map((d: any) => [d.$['android:name'], d.$['android:value']]));
    expect(meta).toEqual({ console_app_id_value: APP_ID, sdk_pay_scheme_value: 'gornitsauzorypay', internal_config_key: 'react-native' });
    expect(plugin.SCHEME).toBe('gornitsauzorypay');
    const filters = out.manifest.application[0].activity[0]['intent-filter'];
    expect(filters.filter((f: any) => (f.data ?? []).some((d: any) => d.$['android:scheme'] === plugin.SCHEME))).toHaveLength(1);
    plugin.transforms.manifest(out, APP_ID);
    expect(out.manifest.application[0].activity[0]['intent-filter']).toHaveLength(2);
  });

  test('без RUSTORE_APP_ID плагин ничего не вписывает — сборка та же, что до RuStore Pay', () => {
    const mods = (id: string | undefined) => {
      const was = process.env.EXPO_PUBLIC_RUSTORE_APP_ID;
      if (id === undefined) delete process.env.EXPO_PUBLIC_RUSTORE_APP_ID; else process.env.EXPO_PUBLIC_RUSTORE_APP_ID = id;
      try {
        return Object.keys(plugin({ name: 'uzory', slug: 'uzory' }).mods?.android ?? {}).sort();
      } finally {
        if (was === undefined) delete process.env.EXPO_PUBLIC_RUSTORE_APP_ID; else process.env.EXPO_PUBLIC_RUSTORE_APP_ID = was;
      }
    };
    expect(mods(undefined)).toEqual([]);
    expect(mods(' ')).toEqual([]);
    expect(mods(APP_ID)).toEqual(['appBuildGradle', 'mainActivity', 'mainApplication', 'manifest', 'projectBuildGradle']);
  });

  test('плагин подключён в app.json, а номер приложения в репозиторий не зашит', async () => {
    const root = `${import.meta.dir}/../..`;
    const app = JSON.parse(await Bun.file(`${root}/app.json`).text());
    expect(app.expo.plugins).toContain('./plugins/with-rustore');
    const wf = await Bun.file(`${root}/.github/workflows/android.yml`).text();
    expect(wf).toContain("EXPO_PUBLIC_RUSTORE_APP_ID: ${{ vars.RUSTORE_APP_ID || '' }}");
    for (const f of ['app.json', '.github/workflows/android.yml', 'src/state/billing.ts', 'plugins/with-rustore.js']) {
      expect({ f, hasId: (await Bun.file(`${root}/${f}`).text()).includes(APP_ID) }).toEqual({ f, hasId: false });
    }
  });
});
