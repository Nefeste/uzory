// Номер версии приложения — один на всё приложение. Поднимается вместе с app.json
// и package.json (docs/05-process.md, «Версии»); сверяет tools/test/version.test.ts.
import { CLOSED_WEB } from './closedWeb';

export const APP_VERSION = '1.0.1';
/** Номер сборки (`versionCode` в app.json) — для отчёта об ошибке. */
export const APP_BUILD = 3;
/**
 * Сборки для проверки (docs/05-process.md, «Версии»): раздел «Для проверки» на главной с «Листом узоров»,
 * открытая библиотека, заглушка RuStore Pay на 127.0.0.1. Это все 0.x, а с 1.0 — закрытая веб-версия:
 * отбор картинок идёт и после выхода. Сборка для телефона 1.x — без них, как в RuStore.
 */
export const INTERNAL = APP_VERSION.startsWith('0.') || CLOSED_WEB;
