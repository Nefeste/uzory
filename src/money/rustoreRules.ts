// из nardy: src/money/rustoreRules.ts @ 63e8ee9 (статусы подписки; права — PlusState «Узоров»);
// коды и тексты ошибок, «Ответ RuStore» (rsText, rsDetail) и причины — из общего набора
// `@gornitsa/kit/rustore-pay/rules` (тег v1.1.0), слова для игрока — BillingFail «Узоров»
// Ответы RuStore Pay → права подписки «Узоры+», цены и причины (чистые функции: их гоняют тесты
// под Bun без телефона, tools/test/rustore.test.ts). Правила прав по сохранённому ответу — в движке
// (src/engine/plus.ts); здесь — только как ответ RuStore становится этим ответом.
import { LOOK_PRODUCTS } from '../engine/looks';
import { PLUS_OFFLINE_MS, type PlusPeriod, type PlusState, type PlusStatus } from '../engine/plus';
import type { BillingFail, LookPrice, Product, ProductId } from '../state/billingApi';
import { causeReasonOf, reasonOf, type RsReason } from '@gornitsa/kit/rustore-pay/rules';
import type { RsProduct, RsPurchase } from './rustore';

export { rsDetail, rsText } from '@gornitsa/kit/rustore-pay/rules';

/** Товары в консоли RuStore и их срок — вечные, как идентификатор приложения. */
export const PLUS_PRODUCTS: Readonly<Record<ProductId, PlusPeriod>> = { uzory_plus_month: 'month', uzory_plus_year: 'year' };
export const PRODUCT_IDS = Object.keys(PLUS_PRODUCTS) as ProductId[];

const isProduct = (id: string): id is ProductId => (PRODUCT_IDS as readonly string[]).includes(id);

/**
 * Причины набора (`reasonOf`, `causeReasonOf` — коды и тексты Pay SDK 11.1.0 и core 10.5.0, разбор «Нард»,
 * 23.10.2026) → что сказать игроку (docs/specs/2026-09-plus.md, «Неудачные случаи»): нет или устарел
 * RuStore — «установите или обновите»; нет сети — «нет связи». Остальные причины набора — нет входа,
 * номера приложения, схемы — у «Узоров» отдельных слов не имеют: «платёж не прошёл» или «Не удалось
 * узнать цену» со строкой «Ответ RuStore».
 */
const SAY: Readonly<Partial<Record<RsReason, BillingFail>>> = { 'no-rustore': 'no-store', outdated: 'no-store', offline: 'offline' };
const say = (r: RsReason | null): BillingFail | null => (r ? SAY[r] ?? null : null);

/**
 * Покупка не прошла (`buy` набора) → что сказать игроку: отказ игрока и отказ войти в RuStore (окно
 * входа RuStore показывает само) — тихо назад; нет или устарел RuStore; нет сети; прочее — «платёж не
 * прошёл».
 */
export function failOf(r: { cancelled: boolean; reason: RsReason | null }): BillingFail {
  if (r.cancelled || r.reason === 'not-signed-in') return 'cancelled';
  return say(r.reason) ?? 'failed';
}

/**
 * Отказ `getPurchaseAvailability` → что сказать игроку; `null` — текст незнакомый. Любую ошибку по дороге —
 * сеть, отказ сервера RuStore, номер приложения, нет RuStore или входа — SDK отдаёт не исключением, а ответом
 * «недоступно», и обёртка для React Native передаёт из него только текст (`cause`). Поэтому причина — по тексту.
 */
export function causeOf(cause: string): BillingFail | null {
  return say(causeReasonOf(cause));
}

/** Ошибка SDK (отказ промиса обёртки) → что сказать игроку о магазине; `null` — причина не видна. */
export function unavailableOf(e: unknown): BillingFail | null {
  return say(reasonOf(e));
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

/**
 * Купленные оформления навсегда (0.18.1; docs/specs/2026-10-looks.md, «Покупка»): разовые покупки наших
 * товаров в статусе CONFIRMED. По документации Pay SDK для React Native 11.1.0 (rustore.ru/help/sdk/pay/
 * react-native/11-1-0, 31.10.2026): CONFIRMED — «покупка успешно оплачена»; оплата в одну стадию
 * подтверждения не требует; PAID и REVERSED — только у двухстадийной (её игра не запускает). Список
 * покупок без фильтров отдаёт PAID, CONFIRMED, ACTIVE и PAUSED — возвращённая покупка (REFUNDED) в него
 * не попадает, и оформление снова заперто. Порядок — как в каталоге, без повторов.
 */
export function looksOf(list: readonly RsPurchase[]): string[] {
  const got = new Set<string>();
  for (const p of list) {
    const pp = p.productPurchase;
    if (pp && pp.status === 'CONFIRMED' && LOOK_PRODUCTS.includes(pp.productId)) got.add(pp.productId);
  }
  return LOOK_PRODUCTS.filter((id) => got.has(id));
}

/** Товары RuStore → цены оформлений: только наши разовые товары и только с ценой; порядок — как в каталоге. */
export function lookPricesOf(list: readonly RsProduct[]): LookPrice[] {
  const out: LookPrice[] = [];
  for (const id of LOOK_PRODUCTS) {
    const price = list.find((x) => x.productId === id)?.amountLabel?.trim();
    if (price) out.push({ id, price });
  }
  return out;
}
