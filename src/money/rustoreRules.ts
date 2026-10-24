// из nardy: src/money/rustoreRules.ts @ 63e8ee9 (rsCode и статусы подписки; права — PlusState «Узоров»);
// «Ответ RuStore» (causeOf, rsText, rsDetail) — из nardy @ af8b683, причины — BillingFail «Узоров»
// Ответы RuStore Pay → права подписки «Узоры+», цены и причины (чистые функции: их гоняют тесты
// под Bun без телефона, tools/test/rustore.test.ts). Правила прав по сохранённому ответу — в движке
// (src/engine/plus.ts); здесь — только как ответ RuStore становится этим ответом.
import { PLUS_OFFLINE_MS, type PlusPeriod, type PlusState, type PlusStatus } from '../engine/plus';
import type { BillingFail, Product, ProductId } from '../state/billingApi';
import type { RsErrorCode, RsProduct, RsPurchase } from './rustore';

/** Товары в консоли RuStore и их срок — вечные, как идентификатор приложения. */
export const PLUS_PRODUCTS: Readonly<Record<ProductId, PlusPeriod>> = { uzory_plus_month: 'month', uzory_plus_year: 'year' };
export const PRODUCT_IDS = Object.keys(PLUS_PRODUCTS) as ProductId[];

const isProduct = (id: string): id is ProductId => (PRODUCT_IDS as readonly string[]).includes(id);

/** Ошибка Pay SDK: код из списка RuStore или `null`. */
export function rsCode(e: unknown): RsErrorCode | null {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && c.length > 0 ? (c as RsErrorCode) : null;
}

/**
 * Ошибка RuStore → что сказать игроку (docs/specs/2026-09-plus.md, «Неудачные случаи»): нет или
 * устарел RuStore — «установите или обновите»; нет сети — «нет связи»; отказ игрока и отказ войти
 * в RuStore (окно входа RuStore показывает само) — тихо назад; прочее — «платёж не прошёл».
 */
export function failOf(e: unknown): BillingFail {
  switch (rsCode(e)) {
    case 'ProductPurchaseCancelled': case 'RuStoreUserUnauthorizedException': return 'cancelled';
    case 'RuStoreNotInstalledException': case 'RuStoreOutdatedException': return 'no-store';
    case 'RuStorePaymentNetworkException': return 'offline';
    default: return 'failed';
  }
}

/**
 * Ошибки SDK, по которым игроку есть что сказать: код (имя класса) и начало текста — как в Pay SDK 11.1.0
 * и core 10.5.0 (разбор «Нард», 23.10.2026). Остальные — «Не удалось узнать цену» и строка «Ответ RuStore».
 */
const KNOWN: readonly (readonly [code: RsErrorCode, text: string, fail: BillingFail])[] = [
  ['RuStoreNotInstalledException', 'RuStore not installed', 'no-store'],
  ['RuStoreOutdatedException', 'RuStore outdated', 'no-store'],
];

/**
 * Отказ `getPurchaseAvailability` → что сказать игроку; `null` — текст незнакомый. Любую ошибку по дороге —
 * сеть, отказ сервера RuStore, номер приложения, нет RuStore или входа — SDK отдаёт не исключением, а ответом
 * «недоступно», и обёртка для React Native передаёт из него только текст (`cause`). Поэтому причина — по тексту.
 */
export function causeOf(cause: string): BillingFail | null {
  const c = cause.toLowerCase();
  return KNOWN.find((k) => c.includes(k[1].toLowerCase()))?.[2] ?? null;
}

/** Ошибка SDK (отказ промиса обёртки) → что сказать игроку о магазине; `null` — причина не видна. */
export function unavailableOf(e: unknown): BillingFail | null {
  const code = rsCode(e);
  if (code === 'RuStorePaymentNetworkException') return 'offline';
  return KNOWN.find((k) => k[0] === code)?.[2] ?? null;
}

/** Текст для строки «Ответ RuStore»: в одну строку, не длиннее 200 знаков; пустой — `undefined`. */
export function rsText(s: unknown): string | undefined {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  return t || undefined;
}

/** Ошибка SDK для строки «Ответ RuStore»: код и текст, как пришли. */
export function rsDetail(e: unknown): string | undefined {
  const m = (e as { message?: unknown } | null)?.message;
  return rsText([rsCode(e), typeof m === 'string' ? m : ''].filter(Boolean).join(': '));
}

/**
 * Цена строкой магазина → копейки, для «≈ 83 ₽ в месяц» у годовой: «990 ₽», «1 490 ₽»,
 * «990,00 ₽». Не рубли или не разобралось — нет (тогда нет и этой строки). Берётся из строки,
 * а не из числа `price` SDK: в каких единицах оно, пример RuStore не говорит.
 */
export function kopecksOf(label: string): number | undefined {
  if (!/₽|руб/i.test(label)) return undefined;
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(label.replace(/[^\d.,]/g, '').replace(/[.,]$/, ''));
  if (!m) return undefined;
  const kop = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  const v = Number(m[1]) * 100 + kop;
  return v > 0 ? v : undefined;
}

/** Товары RuStore → цены для экрана «Узоры+»: только наши подписки и только с ценой; месяц, затем год. */
export function productsOf(list: readonly RsProduct[]): Product[] {
  const out: Product[] = [];
  for (const id of PRODUCT_IDS) {
    const p = list.find((x) => x.productId === id);
    const price = p?.amountLabel?.trim();
    if (!p || !price) continue;
    const kopecks = kopecksOf(price);
    out.push(kopecks ? { id, period: PLUS_PRODUCTS[id], price, kopecks } : { id, period: PLUS_PRODUCTS[id], price });
  }
  return out;
}

/**
 * Статус подписки RuStore Pay → статус «Узоров+». Как в «Нардах»: ACTIVE — действует, PAUSED —
 * списание не прошло, доступ приостановлен (Hold), CLOSED — закрыта. Прочие (счёт создан, но не
 * оплачен, и всё незнакомое) прав не дают и не считаются подпиской. Какой статус приходит в
 * льготный период (Grace), пример RuStore не говорит — сверить в тестовом режиме
 * (docs/specs/2026-09-plus.md, «Что изменилось», 20.10.2026).
 */
const STATUS: Readonly<Record<string, PlusStatus>> = { ACTIVE: 'active', PAUSED: 'hold', CLOSED: 'closed' };
const RANK: Readonly<Record<PlusStatus, number>> = { none: 0, closed: 1, hold: 2, grace: 3, active: 3 };

/**
 * Права по списку покупок RuStore (spec, «Протокол»): из подписок «Узоров+» — лучшая (действует →
 * приостановлена → закрыта), из равных — с дальней датой. Срок — `expirationDate`; дата не
 * разобралась или уже прошла, а RuStore говорит «действует» (списание за новый срок идёт) — срока
 * нет, и по правилам движка это трое суток с проверки: каждая проверка их продлевает.
 */
export function plusStateOf(list: readonly RsPurchase[], now: number): PlusState {
  // до какого времени открыто по этому ответу — им и сравниваются равные по статусу
  const end = (s: PlusState) => s.until ?? (s.status === 'active' ? now + PLUS_OFFLINE_MS : 0);
  let best: PlusState = { status: 'none', checkedAt: now };
  for (const p of list) {
    const sub = p.subscriptionPurchase;
    if (!sub || !isProduct(sub.productId)) continue;
    const status = STATUS[sub.status];
    if (!status) continue;
    const t = Date.parse(sub.expirationDate);
    const s: PlusState = { status, product: PLUS_PRODUCTS[sub.productId], checkedAt: now };
    if (Number.isFinite(t) && (status !== 'active' || t > now)) s.until = t;
    if (RANK[status] > RANK[best.status] || (RANK[status] === RANK[best.status] && end(s) > end(best))) best = s;
  }
  return best;
}
