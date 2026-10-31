// Нативный модуль RuStore Pay (docs/specs/2026-09-plus.md, «Протокол») — из общего набора студии
// `@gornitsa/kit/rustore-pay` (Nefeste/gornitsa-kit, тег v1.1.0; ADR студии 0022): типы обёртки
// RuStore Pay для React Native 11.1.0 с явными `null` и сам модуль. Его Android-часть приходит из
// maven RuStore и регистрируется плагином набора `@gornitsa/kit/rustore-pay/plugin` (app.json).
// Правила ответов «Узоров» — ./rustoreRules.ts, магазин для экранов — ./rustoreBilling.ts.
export { pay } from '@gornitsa/kit/rustore-pay';
export type {
  PayNative, RsErrorCode, RsProduct, RsProductPurchase, RsProductType, RsPurchase, RsPurchaseResult, RsSubscriptionPurchase,
} from '@gornitsa/kit/rustore-pay';
