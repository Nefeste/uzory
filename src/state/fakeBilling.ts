// Заглушка RuStore Pay для сценария tools/e2e/smoke.ts (docs/06-testing.md, §5;
// docs/specs/2026-09-plus.md, критерий 3): без сети и без денег. Режим и купленное — запись
// `uzory.billing.fake.v1` в хранилище браузера; кладёт её сценарий, читает ./billing.web.ts.
// Цены — не те, что на образце экрана: по ним видно, что экран взял их у магазина.
import type { PlusState } from '../engine/plus';
import type { Billing, BillingFail, Product } from './billingApi';

export const FAKE_KEY = 'uzory.billing.fake.v1';

/** `ok` — покупка проходит; прочее — так магазин и отвечает: отказ игрока, сбой платежа, нет сети, нет RuStore. */
export type FakeMode = 'ok' | BillingFail;

const MODES: readonly FakeMode[] = ['ok', 'cancelled', 'failed', 'offline', 'no-store'];
const DAY = 86400000;

export const FAKE_PRODUCTS: Product[] = [
  { id: 'uzory_plus_month', period: 'month', price: '249 ₽', kopecks: 24900 },
  { id: 'uzory_plus_year', period: 'year', price: '1490 ₽', kopecks: 149000 },
];

interface FakeRecord {
  mode: FakeMode;
  /** что «купили»: магазин отдаёт это и после перезагрузки — как покупку из RuStore */
  bought?: { product: 'month' | 'year'; at: number };
}

/** Чужое и испорченное — как «покупка проходит, ничего не куплено». */
function parse(raw: string | null): FakeRecord {
  try {
    const r = JSON.parse(raw ?? '') as Partial<FakeRecord>;
    const mode = MODES.includes(r.mode as FakeMode) ? (r.mode as FakeMode) : 'ok';
    const b = r.bought;
    const bought = b && (b.product === 'month' || b.product === 'year') && Number.isFinite(b.at) ? b : undefined;
    return bought ? { mode, bought } : { mode };
  } catch {
    return { mode: 'ok' };
  }
}

/** Режим перечитывается на каждом вопросе: сценарий меняет его, не перезагружая страницу. */
export function fakeBilling(read: () => string | null, write: (raw: string) => void, now: () => number): Billing {
  const state = (r: FakeRecord, t: number): PlusState =>
    r.bought
      ? { status: 'active', product: r.bought.product, until: r.bought.at + (r.bought.product === 'year' ? 365 : 30) * DAY, checkedAt: t }
      : { status: 'none', checkedAt: t };
  const silent = (mode: FakeMode) => mode === 'offline' || mode === 'no-store';
  return {
    available: true,
    products: async () => (silent(parse(read()).mode) ? null : FAKE_PRODUCTS.map((p) => ({ ...p }))),
    purchase: async (id) => {
      const r = parse(read());
      if (r.mode !== 'ok') return { ok: false, fail: r.mode };
      const t = now();
      const next: FakeRecord = { mode: r.mode, bought: { product: id === 'uzory_plus_year' ? 'year' : 'month', at: t } };
      write(JSON.stringify(next));
      return { ok: true, state: state(next, t) };
    },
    status: async () => {
      const r = parse(read());
      return silent(r.mode) ? null : state(r, now());
    },
  };
}
