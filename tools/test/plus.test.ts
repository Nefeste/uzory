// Подписка «Узоры+» (docs/specs/2026-09-plus.md): права по последнему ответу RuStore Pay без
// сети, когда игра сама говорит о подписке, день следующего списания; заглушка RuStore Pay
// сценария (src/state/fakeBilling.ts).
import { describe, expect, test } from 'bun:test';
import { nextCharge, normalizePlus, offerOnDone, PLUS_OFFLINE_MS, plusOpen } from '../../src/engine/plus';
import { FAKE_PRODUCTS, fakeBilling } from '../../src/state/fakeBilling';

const DAY = 86400000;
const now = Date.UTC(2026, 9, 5, 12);

describe('права подписки', () => {
  test('действует и льготный период — открыто до конца оплаченного срока', () => {
    expect(plusOpen({ status: 'active', until: now + DAY, checkedAt: now - 10 * DAY }, now)).toBe(true);
    expect(plusOpen({ status: 'grace', until: now + DAY, checkedAt: now }, now)).toBe(true);
    expect(plusOpen({ status: 'active', until: now - 1, checkedAt: now - DAY }, now)).toBe(false);
  });

  test('срок неизвестен — трое суток с последней проверки', () => {
    expect(plusOpen({ status: 'active', checkedAt: now - PLUS_OFFLINE_MS }, now)).toBe(true);
    expect(plusOpen({ status: 'active', checkedAt: now - PLUS_OFFLINE_MS - 1 }, now)).toBe(false);
  });

  test('приостановка, закрытая, не было — заперто', () => {
    for (const status of ['hold', 'closed', 'none'] as const) expect(plusOpen({ status, until: now + DAY, checkedAt: now }, now)).toBe(false);
    expect(plusOpen(null, now)).toBe(false);
  });

  test('испорченная запись — как «подписки не было»', () => {
    expect(normalizePlus(null)).toBeNull();
    expect(normalizePlus({ status: 'forever', checkedAt: now })).toBeNull();
    expect(normalizePlus({ status: 'active' })).toBeNull();
    expect(normalizePlus({ status: 'active', checkedAt: now, until: 'завтра', product: 'week' })).toEqual({ status: 'active', checkedAt: now });
    expect(normalizePlus({ status: 'grace', checkedAt: now, until: now + DAY, product: 'year' })).toEqual({ status: 'grace', checkedAt: now, until: now + DAY, product: 'year' });
  });
});

describe('строка «Узоры+» на «Готово»', () => {
  const installed = '2026-10-01';
  test('не в первые три дня после установки', () => {
    expect(offerOnDone({ today: '2026-10-03', installed, free: true })).toBe(false);
    expect(offerOnDone({ today: '2026-10-04', installed, free: true })).toBe(true);
  });
  test('не второй раз за день и только после бесплатной картинки', () => {
    expect(offerOnDone({ today: '2026-10-10', installed, shownOn: '2026-10-10', free: true })).toBe(false);
    expect(offerOnDone({ today: '2026-10-10', installed, shownOn: '2026-10-09', free: true })).toBe(true);
    expect(offerOnDone({ today: '2026-10-10', installed, free: false })).toBe(false);
  });
});

describe('следующее списание', () => {
  test('через месяц и через год', () => {
    expect(nextCharge('2026-10-05', 'month')).toBe('2026-11-05');
    expect(nextCharge('2026-12-20', 'month')).toBe('2027-01-20');
    expect(nextCharge('2026-10-05', 'year')).toBe('2027-10-05');
  });
  test('числа, которого нет в месяце, — последний день месяца', () => {
    expect(nextCharge('2027-01-31', 'month')).toBe('2027-02-28');
    expect(nextCharge('2028-01-30', 'month')).toBe('2028-02-29');
    expect(nextCharge('2028-02-29', 'year')).toBe('2029-02-28');
    expect(nextCharge('2026-03-31', 'month')).toBe('2026-04-30');
  });
});

describe('заглушка RuStore Pay сценария', () => {
  const store = (raw: string | null) => {
    const box = { raw };
    return { box, billing: fakeBilling(() => box.raw, (r) => { box.raw = r; }, () => now) };
  };

  test('«куплено»: цены магазина, покупка года открывает библиотеку на год и остаётся после перезагрузки', async () => {
    const { box, billing } = store(JSON.stringify({ mode: 'ok' }));
    expect(billing.available).toBe(true);
    expect(await billing.products()).toEqual(FAKE_PRODUCTS);
    expect(await billing.status()).toEqual({ status: 'none', checkedAt: now });
    const r = await billing.purchase('uzory_plus_year');
    expect(r).toEqual({ ok: true, state: { status: 'active', product: 'year', until: now + 365 * DAY, checkedAt: now } });
    // магазин отдаёт покупку и новой странице — как RuStore Pay после переустановки
    const again = fakeBilling(() => box.raw, () => {}, () => now + DAY);
    const st = await again.status();
    expect(st?.status).toBe('active');
    expect(plusOpen(st, now + DAY)).toBe(true);
  });

  test('отказ, сбой, нет сети, нет RuStore — так магазин и отвечает; без сети и RuStore цен и прав нет', async () => {
    for (const mode of ['cancelled', 'failed', 'offline', 'no-store'] as const) {
      const { box, billing } = store(JSON.stringify({ mode }));
      expect(await billing.purchase('uzory_plus_month')).toEqual({ ok: false, fail: mode });
      expect(JSON.parse(box.raw!)).toEqual({ mode });
      const silent = mode === 'offline' || mode === 'no-store';
      expect(await billing.products()).toEqual(silent ? null : FAKE_PRODUCTS);
      expect(await billing.status()).toEqual(silent ? null : { status: 'none', checkedAt: now });
    }
  });

  test('режим меняется без перезагрузки; испорченная запись — «покупка проходит»', async () => {
    const { box, billing } = store(JSON.stringify({ mode: 'failed' }));
    expect(await billing.purchase('uzory_plus_month')).toEqual({ ok: false, fail: 'failed' });
    box.raw = JSON.stringify({ mode: 'ok' });
    expect((await billing.purchase('uzory_plus_month')).ok).toBe(true);
    expect(JSON.parse(box.raw!).bought).toEqual({ product: 'month', at: now });
    const broken = store('{не json');
    expect(await broken.billing.products()).toEqual(FAKE_PRODUCTS);
  });
});
