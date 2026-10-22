// Магазин подписки «Узоры+» (docs/specs/2026-09-plus.md, «Протокол»): цены, покупка и права —
// у RuStore Pay (src/money/, перенесён из «Нард»; код денег — путь владельца). Магазин есть, когда в
// сборке нативный модуль RuStore Pay (plugins/with-rustore.js) и номер приложения в консоли
// RuStore — переменная репозитория `RUSTORE_APP_ID`, в сборку — `EXPO_PUBLIC_RUSTORE_APP_ID`
// (.github/workflows/android.yml). Без номера магазина нет, как до RuStore Pay: экран «Узоры+» —
// образец, а всё бесплатное работает. Веб-версия — ./billing.web.ts; что спрашивается у
// магазина — ./billingApi.ts.
import { pay } from '../money/rustore';
import { rustoreBilling } from '../money/rustoreBilling';
import type { Billing } from './billingApi';

export * from './billingApi';

/** Номер приложения в консоли RuStore; пусто — покупок в сборке нет. */
const RUSTORE_APP_ID = (process.env.EXPO_PUBLIC_RUSTORE_APP_ID ?? '').trim();

export const billing: Billing = rustoreBilling(pay, RUSTORE_APP_ID);
