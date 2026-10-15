// Веб-версия: магазина нет — RuStore Pay только в сборке для RuStore (./billing.ts). Сценарию
// tools/e2e/smoke.ts нужен магазин, чтобы пройти экран «Узоры+» и строку на «Готово»: в сборке
// 0.x, открытой с этого же компьютера (как ключ сценария, ./net-env.web.ts), и только когда он
// положил запись заглушки в хранилище — заглушка RuStore Pay (./fakeBilling.ts).
import { INTERNAL } from '../version';
import { type Billing, noBilling } from './billingApi';
import { FAKE_KEY, fakeBilling } from './fakeBilling';
import { LOCAL_TEST } from './net-env';

export * from './billingApi';

function fake(): Billing | null {
  if (!INTERNAL || !LOCAL_TEST) return null;
  try {
    const store = globalThis.localStorage;
    if (!store || store.getItem(FAKE_KEY) === null) return null;
    return fakeBilling(() => store.getItem(FAKE_KEY), (raw) => store.setItem(FAKE_KEY, raw), () => Date.now());
  } catch {
    return null;
  }
}

export const billing: Billing = fake() ?? noBilling;
