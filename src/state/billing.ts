// Магазин подписки «Узоры+» (docs/specs/2026-09-plus.md, «Протокол»): цены, покупка и права —
// у RuStore Pay, только в сборке для RuStore. Он подключается после ИП и RuStore Pay на ИП (В2):
// код переносится из «Нард» по текущей документации SDK, а не по памяти (AGENTS.md). До этого
// магазина нет — экран «Узоры+» так и говорит, а всё бесплатное работает. Веб-версия —
// ./billing.web.ts; что спрашивается у магазина — ./billingApi.ts.
import { type Billing, noBilling } from './billingApi';

export * from './billingApi';

export const billing: Billing = noBilling;
